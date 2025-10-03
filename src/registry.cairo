use core::num::traits::Zero;
use starknet::contract_address::ContractAddress;
use starknet::storage::{
    Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
    StoragePointerWriteAccess,
};
use crate::interface::{IHTLCDispatcher, IHTLCDispatcherTrait, IUniqueDepositAddress};
#[starknet::contract]
mod registry {
    use super::IHTLCDispatcher;
use crate::htlc;
    use core::array::ArrayTrait;
    use core::hash::HashStateTrait;
    use core::pedersen::PedersenTrait;
    use core::traits::Into;
    use openzeppelin::access::ownable::OwnableComponent;
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use starknet::event::EventEmitter;
    use starknet::syscalls::deploy_syscall;
    use starknet::{ClassHash, get_contract_address, ContractAddress, get_caller_address};
    use crate::interface::IRegistry;
    use super::*;

    component!(path: OwnableComponent, storage: ownable, event: OwnableEvent);

    #[abi(embed_v0)]
    impl OwnableImpl = OwnableComponent::OwnableImpl<ContractState>;
    impl OwnableInternalImpl = OwnableComponent::InternalImpl<ContractState>;

    const CONTRACT_ADDRESS_PREFIX: felt252 = 'STARKNET_CONTRACT_ADDRESS';

    #[storage]
    struct Storage {
        #[substorage(v0)]
        ownable: OwnableComponent::Storage,
        htlcs: Map<ContractAddress, ContractAddress>, // token -> htlc mapping
        uda_class_hash: ClassHash // class hash
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        #[flat]
        OwnableEvent: OwnableComponent::Event,
        HTLCAdded: HTLCAdded,
        UDACreated: UDACreated,
    }

    #[derive(Drop, starknet::Event)]
    struct HTLCAdded {
        #[key]
        htlc_address: ContractAddress,
        #[key]
        token: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct UDACreated {
        #[key]
        address_uda: ContractAddress,
        #[key]
        refund_address: ContractAddress,
        #[key]
        token: ContractAddress,
    }

    pub mod Error {
        pub const INVALID_ADDRESS_PARAMETERS: felt252 = 'Invalid address parameters';
        pub const ZERO_TIMELOCK: felt252 = 'Zero timelock';
        pub const ZERO_AMOUNT: felt252 = 'Zero amount';
        pub const INVALID_ADDRESS: felt252 = 'Invalid address';
        pub const INSUFFICIENT_FUNDS: felt252 = 'Insufficient funds deposited';
        pub const INVALID_HTLC_ADDRESS: felt252 = 'Invalid HTLC address';
        pub const TOKEN_NOT_FOUND: felt252 = 'Token not found';
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress, classHash: ClassHash) {
        self._validate_class_hash(classHash);

        self.ownable.initializer(owner);
        self.uda_class_hash.write(classHash);
    }

    #[abi(embed_v0)]
    impl RegistryImpl of IRegistry<ContractState> {
        fn create_swap_address(
            ref self: ContractState,
            htlc_address: ContractAddress,
            refund_address: ContractAddress,
            redeemer: ContractAddress,
            timelock: u128,
            secret_hash: [u32; 8],
            amount: u256,
            destination_data: Span<felt252>,
        ) -> ContractAddress {
            self._validate_params(refund_address, redeemer, timelock, amount, htlc_address);

            let token_address = IHTLCDispatcher { contract_address: htlc_address }.token();

            let predicted_address = self
                .get_address(
                    htlc_address,
                    refund_address,
                    redeemer,
                    timelock,
                    secret_hash,
                    amount,
                    destination_data,
                );

            let erc20 = IERC20Dispatcher { contract_address: token_address };
            let balance = erc20.balance_of(predicted_address);
            assert(balance >= amount, Error::INSUFFICIENT_FUNDS);

            let deployed_address = self
                ._deploy_uda(
                    htlc_address,
                    refund_address,
                    redeemer,
                    timelock,
                    secret_hash,
                    amount,
                    destination_data,
                    predicted_address,
                );

            self.emit(UDACreated { address_uda: deployed_address, refund_address, token: token_address  });

            deployed_address
        }

        fn get_address(
            self: @ContractState,
            htlc_address: ContractAddress,
            refund_address: ContractAddress,
            redeemer: ContractAddress,
            timelock: u128,
            secret_hash: [u32; 8],
            amount: u256,
            destination_data: Span<felt252>,
        ) -> ContractAddress {
            self._validate_params(refund_address, redeemer, timelock, amount, htlc_address);

            self
                ._compute_address(
                    htlc_address,
                    refund_address,
                    redeemer,
                    timelock,
                    secret_hash,
                    amount,
                    destination_data,
                )
        }

        fn add_htlc(
            ref self: ContractState, htlc_address: ContractAddress, token: ContractAddress,
        ) {
            self.ownable.assert_only_owner();
            self._validate_contract_address(htlc_address);

            self.htlcs.write(token, htlc_address);
            self.emit(HTLCAdded { htlc_address, token });
        }

        fn get_htlc_for_token(self: @ContractState, token: ContractAddress) -> ContractAddress {
            self.htlcs.read(token)
        }

        fn get_owner(self: @ContractState) -> ContractAddress {
            self.ownable.owner()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _validate_params(
            self: @ContractState,
            refund_address: ContractAddress,
            redeemer: ContractAddress,
            timelock: u128,
            amount: u256,
            htlc_address: ContractAddress,
        ) {
            assert( get_caller_address() != redeemer, Error::INVALID_ADDRESS_PARAMETERS);
            assert(!htlc_address.is_zero(), Error::INVALID_HTLC_ADDRESS);
            let token = IHTLCDispatcher { contract_address: htlc_address }.token();
            assert(htlc_address == self.htlcs.read(token), Error::INVALID_HTLC_ADDRESS);

            assert(
                !redeemer.is_zero() && !refund_address.is_zero() && redeemer != refund_address,
                Error::INVALID_ADDRESS_PARAMETERS,
            );
            assert(timelock > 0, Error::ZERO_TIMELOCK);
            assert(amount > 0, Error::ZERO_AMOUNT);
        }

        fn _validate_contract_address(self: @ContractState, address: ContractAddress) {
            assert(!address.is_zero(), Error::INVALID_ADDRESS);
        }

        fn _validate_class_hash(self: @ContractState, address: ClassHash) {
            assert(!address.is_zero(), Error::INVALID_ADDRESS);
        }

        fn _compute_address(
            self: @ContractState,
            htlc_address: ContractAddress,
            refund_address: ContractAddress,
            redeemer: ContractAddress,
            timelock: u128,
            secret_hash: [u32; 8],
            amount: u256,
            destination_data: Span<felt252>,
        ) -> ContractAddress {
            let salt = self
                ._compute_salt(
                    refund_address, redeemer, timelock, secret_hash, amount, destination_data,
                );

            self
                ._compute_address_from_salt(
                    htlc_address,
                    refund_address,
                    redeemer,
                    timelock,
                    secret_hash,
                    amount,
                    destination_data,
                    salt,
                    self.uda_class_hash.read(),
                )
        }
        fn _compute_salt(
            self: @ContractState,
            refund_address: ContractAddress,
            redeemer: ContractAddress,
            timelock: u128,
            secret_hash: [u32; 8],
            amount: u256,
            destination_data: Span<felt252>,
        ) -> felt252 {
            let mut hasher = PedersenTrait::new(0);
            hasher = hasher.update(refund_address.into());
            hasher = hasher.update(redeemer.into());
            hasher = hasher.update(timelock.into());

            // Hash each part of secret hash [u32; 8]
            for hash_part in secret_hash.span() {
                let hash_int: u32 = *hash_part;
                hasher = hasher.update(hash_int.into());
            }

            hasher = hasher.update(amount.low.into());
            hasher = hasher.update(amount.high.into());

            for data in destination_data {
                hasher = hasher.update(*data);
            }

            hasher.finalize()
        }

        fn _compute_address_from_salt(
            self: @ContractState,
            htlc_address: ContractAddress,
            refund_address: ContractAddress,
            redeemer: ContractAddress,
            timelock: u128,
            secret_hash: [u32; 8],
            amount: u256,
            destination_data: Span<felt252>,
            salt: felt252,
            class_hash: ClassHash,
        ) -> ContractAddress {
            let mut constructor_calldata: Array<felt252> = ArrayTrait::new();

            constructor_calldata.append(htlc_address.into());
            constructor_calldata.append(refund_address.into());
            constructor_calldata.append(redeemer.into());
            constructor_calldata.append(timelock.into());

            // Add secret_hash array [u32; 8]
            for hash_part in secret_hash.span() {
                let hash_int: u32 = *hash_part;
                constructor_calldata.append(hash_int.into());
            }

            // Add amount u256 (low, high)
            constructor_calldata.append(amount.low.into());
            constructor_calldata.append(amount.high.into());

            // Add destination_data as Span<felt252>
            constructor_calldata.append(destination_data.len().into());
            for data in destination_data {
                constructor_calldata.append(*data);
            }

            // Hash the constructor calldata
            let mut constructor_hasher = PedersenTrait::new(0);
            for param in constructor_calldata.span() {
                constructor_hasher = constructor_hasher.update(*param);
            }
            let constructor_calldata_hash = constructor_hasher
                .update(constructor_calldata.len().into())
                .finalize();

            // Compute the contract address
            let contract_address_hash = PedersenTrait::new(0)
                .update(CONTRACT_ADDRESS_PREFIX)
                .update(get_contract_address().into()) // deployer address (registry)
                .update(salt)
                .update(class_hash.into())
                .update(constructor_calldata_hash)
                .update(5)
                .finalize();

            contract_address_hash.try_into().unwrap()
        }

        fn _deploy_uda(
            ref self: ContractState,
            htlc_address: ContractAddress,
            refund_address: ContractAddress,
            redeemer: ContractAddress,
            timelock: u128,
            secret_hash: [u32; 8],
            amount: u256,
            destination_data: Span<felt252>,
            _predicted_address: ContractAddress,
        ) -> ContractAddress {
            let salt = self
                ._compute_salt(
                    refund_address, redeemer, timelock, secret_hash, amount, destination_data,
                );

            let mut constructor_calldata: Array<felt252> = ArrayTrait::new();

            // UDA constructor parameters in correct order:
            // htlc_address: ContractAddress,
            // refund_address: ContractAddress,
            // redeemer: ContractAddress,
            // timelock: u128,
            // secret_hash: [u32; 8],
            // amount: u256,
            // destination_data: Span<felt252>,

            constructor_calldata.append(htlc_address.into());
            constructor_calldata.append(refund_address.into());
            constructor_calldata.append(redeemer.into());
            constructor_calldata.append(timelock.into());

            // Add secret_hash array [u32; 8]
            for hash_part in secret_hash.span() {
                let hash_int: u32 = *hash_part;
                constructor_calldata.append(hash_int.into());
            }

            // Add amount u256 (low, high)
            constructor_calldata.append(amount.low.into());
            constructor_calldata.append(amount.high.into());

            // Add destination_data as Span<felt252>
            constructor_calldata.append(destination_data.len().into());
            for data in destination_data {
                constructor_calldata.append(*data);
            }

            match deploy_syscall(
                self.uda_class_hash.read(), salt, constructor_calldata.span(), false,
            ) {
                Result::Ok((deployed_address, _)) => { deployed_address },
                Result::Err(_err) => {
                    // Contract already exists
                    _predicted_address
                },
            }
        }
    }
}
