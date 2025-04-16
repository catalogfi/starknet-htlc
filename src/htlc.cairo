//! # HTLC Smart Contract for Atomic Swaps
//!
//! @author  Garden Finance
//! @title   HTLC smart contract for atomic swaps
//! @notice  Any signer can create an order to serve as one of either halves of a cross-chain
//!          atomic swap for any user with respective valid signatures.
//! @dev     The contract can be used to create an order to serve as the commitment for two
//!          types of users:
//!          Initiator functions: 1. initiate
//!                               2. refund
//!          Redeemer function: 1. redeem
#[starknet::contract]
pub mod HTLC {
    use core::num::traits::Zero;
    use starknet::{ContractAddress, get_caller_address, get_block_info, get_contract_address};
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerWriteAccess,
        StoragePointerReadAccess,
    };
    use core::poseidon::{PoseidonTrait};
    use core::option::OptionTrait;
    use core::traits::{Into, TryInto};
    use core::sha256::compute_sha256_u32_array;
    use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
    use openzeppelin::account::interface::{ISRC6Dispatcher, ISRC6DispatcherTrait};
    use core::hash::{HashStateTrait, HashStateExTrait};
    use crate::interface::{IHTLC, IMessageHash};
    use crate::interface::struct_hash::{
        Initiate, MessageHashInitiate, instantRefund, MessageHashInstantRefund,
    };
    use crate::interface::events::{Initiated, Redeemed, Refunded};
    use core::starknet::event::EventEmitter;


    pub const CHAIN_ID: felt252 = 0x534e5f4d41494e; // SN_MAIN
    pub const NAME: felt252 = 'HTLC';
    pub const VERSION: felt252 = '1';

    pub const INITIATE_TYPE_HASH: felt252 = selector!(
        "\"Initiate\"(\"redeemer\":\"ContractAddress\",\"amount\":\"u256\",\"timelock\":\"u128\",\"secretHash\":\"u128*\")\"u256\"(\"low\":\"u128\",\"high\":\"u128\")",
    );
    pub const U256_TYPE_HASH: felt252 = selector!("\"u256\"(\"low\":\"u128\",\"high\":\"u128\")");

    pub const INSTANT_REFUND_TYPE_HASH: felt252 = selector!(
        "\"instantRefund\"(\"orderID\":\"felt\")",
    );


    #[storage]
    struct Storage {
        pub token: IERC20Dispatcher,
        pub orders: Map::<felt252, Order>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Initiated: Initiated,
        Redeemed: Redeemed,
        Refunded: Refunded,
    }

    #[derive(Drop, Serde, starknet::Store, Debug)]
    pub struct Order {
        is_fulfilled: bool,
        initiator: ContractAddress,
        redeemer: ContractAddress,
        initiated_at: u128,
        timelock: u128,
        amount: u256,
    }

    #[constructor]
    fn constructor(ref self: ContractState, token: ContractAddress) {
        self.token.write(IERC20Dispatcher { contract_address: token });
    }

    #[abi(embed_v0)]
    pub impl HTLC of IHTLC<ContractState> {
        fn token(self: @ContractState) -> ContractAddress {
            self.token.read().contract_address
        }

        /// @notice  Signers can create an order with order params.
        /// @dev     Secret used to generate secret hash for initiation should be generated randomly
        ///          and SHA-256 hash should be used to support hashing methods on other non-EVM
        ///          chains.
        ///          Signers cannot generate orders with the same secret hash or override an
        ///          existing order.
        /// @param   redeemer  Contract address of the redeemer.
        /// @param   timelock  Timelock period for the HTLC order.
        /// @param   amount  Amount of tokens to trade.
        /// @param   secret_hash  SHA-256 hash of the secret used for redemption.
        fn initiate(
            ref self: ContractState,
            redeemer: ContractAddress,
            timelock: u128,
            amount: u256,
            secret_hash: [u32; 8],
        ) {
            self.safe_params(redeemer, timelock, amount);
            let sender = get_caller_address();
            self._initiate(sender, sender, redeemer, timelock, amount, secret_hash);
        }

        /// @notice  Allows a signer to initiate an order on behalf of another initiator.
        /// @dev     Ensures the provided parameters are valid before initiating the order.
        ///          Calls `_initiate` with the sender as the initiator.
        ///
        /// @param   initiator    Contract address of the actual initiator.
        /// @param   redeemer     Contract address of the redeemer.
        /// @param   timelock     Timelock period for the HTLC order.
        /// @param   amount       Amount of tokens to be locked.
        /// @param   secret_hash  SHA-256 hash of the secret used for redemption.
        fn initiate_on_behalf(
            ref self: ContractState,
            initiator: ContractAddress,
            redeemer: ContractAddress,
            timelock: u128,
            amount: u256,
            secret_hash: [u32; 8],
        ) {
            self.safe_params(redeemer, timelock, amount);
            let sender = get_caller_address();
            self._initiate(sender, initiator, redeemer, timelock, amount, secret_hash);
        }

        /// @notice  Signers can create an order with order params and signature for a user.
        /// @dev     Secret used to generate secret hash for initiation should be generated randomly
        ///          and SHA-256 hash should be used to support hashing methods on other non-EVM
        ///          chains.
        ///          Signers cannot generate orders with the same secret hash or override an
        ///          existing order.
        /// @param   redeemer  Contract address of the redeemer.
        /// @param   timelock  Timelock period for the HTLC order.
        /// @param   amount  Amount of tokens to trade.
        /// @param   secret_hash  SHA-256 hash of the secret used for redemption.
        /// @param   signature  SNIP-12 signature provided by an authorized user for initiation.
        ///                     The user will be assigned as the initiator.
        fn initiate_with_signature(
            ref self: ContractState,
            initiator: ContractAddress,
            redeemer: ContractAddress,
            timelock: u128,
            amount: u256,
            secret_hash: [u32; 8],
            signature: Array<felt252>,
        ) {
            let intiate = Initiate { redeemer, amount, timelock, secretHash: secret_hash };

            let message_hash = intiate.get_message_hash(initiator);

            let is_valid = ISRC6Dispatcher { contract_address: initiator }
                .is_valid_signature(message_hash, signature);
            let is_valid_signature = is_valid == starknet::VALIDATED || is_valid == 1;
            assert!(is_valid_signature, "HTLC: invalid initiator signature");

            self._initiate(initiator, initiator, redeemer, timelock, amount, secret_hash);
        }

        /// @notice  Signers with the correct secret to an order's secret hash can redeem to claim
        /// the locked token.
        /// @dev     Signers are not allowed to redeem an order with the wrong secret or redeem the
        /// same order multiple times.
        /// @param   order_id  Order ID of the HTLC order.
        /// @param   secret  Secret used to redeem an order.
        fn redeem(ref self: ContractState, order_id: felt252, secret: Array<u32>) {
            let order = self.orders.read(order_id);
            assert!(order.redeemer.is_non_zero(), "HTLC: order not initiated");
            assert!(!order.is_fulfilled, "HTLC: order fulfilled");

            let secret_hash = compute_sha256_u32_array(secret.clone(), 0, 0);
            let initiator_address: felt252 = order.initiator.try_into().unwrap();

            assert!(
                self.generate_order_id(CHAIN_ID, secret_hash, initiator_address) == order_id,
                "HTLC: incorrect secret",
            );

            let updated_order = Order {
                initiator: order.initiator,
                redeemer: order.redeemer,
                amount: order.amount,
                timelock: order.timelock,
                initiated_at: order.initiated_at,
                is_fulfilled: true,
            };
            self.orders.write(order_id, updated_order);

            self.token.read().transfer(order.redeemer, order.amount);
            self.emit(Event::Redeemed(Redeemed { order_id, secret_hash, secret }));
        }

        /// @notice  Signers can refund the locked assets after the timelock block number.
        /// @dev     Signers cannot refund an order before the expiry block number or refund the
        /// same order multiple times.
        ///          Funds will be safely transferred to the initiator.
        /// @param   order_id  Order ID of the HTLC order.
        fn refund(ref self: ContractState, order_id: felt252) {
            let order = self.orders.read(order_id);

            assert!(order.redeemer.is_non_zero(), "HTLC: order not initiated");
            assert!(!order.is_fulfilled, "HTLC: order fulfilled");

            let block_info = get_block_info().unbox();
            let current_block = block_info.block_number;
            assert!(
                (order.initiated_at + order.timelock) < current_block.into(),
                "HTLC: order not expired",
            );

            let updated_order = Order {
                initiator: order.initiator,
                redeemer: order.redeemer,
                amount: order.amount,
                timelock: order.timelock,
                initiated_at: order.initiated_at,
                is_fulfilled: true,
            };
            self.orders.write(order_id, updated_order);

            let contract_address = get_contract_address();
            let balance = self.token.read().balance_of(contract_address);
            assert!(balance >= order.amount, "HTLC: insufficient contract balance");
            self.token.read().transfer(order.initiator, order.amount);

            self.emit(Event::Refunded(Refunded { order_id }));
        }

        /// @notice  Redeemers can let the initiator refund the locked assets before the expiry
        /// block number.
        /// @dev     Signers cannot refund the same order multiple times.
        ///          Funds will be safely transferred to the initiator.
        ///
        /// @param   order_id  Order ID of the HTLC order.
        /// @param   signature  SNIP-12 signature provided by the redeemer for instant refund.
        fn instant_refund(ref self: ContractState, order_id: felt252, signature: Array<felt252>) {
            let refund = instantRefund { orderID: order_id };

            let order = self.orders.read(order_id);
            let message_hash = refund.get_message_hash(order.redeemer);

            let is_valid = ISRC6Dispatcher { contract_address: order.redeemer }
                .is_valid_signature(message_hash, signature);
            let is_valid_signature = is_valid == starknet::VALIDATED || is_valid == 1;
            assert!(is_valid_signature, "HTLC: invalid redeemer signature");
            assert!(!order.is_fulfilled, "HTLC: order fulfilled");

            let updated_order = Order {
                initiator: order.initiator,
                redeemer: order.redeemer,
                amount: order.amount,
                timelock: order.timelock,
                initiated_at: order.initiated_at,
                is_fulfilled: true,
            };

            self.orders.write(order_id, updated_order);

            let contract_address = get_contract_address();
            let balance = self.token.read().balance_of(contract_address);
            assert!(balance >= order.amount, "HTLC: insufficient contract balance");
            self.token.read().transfer(order.initiator, order.amount);

            self.emit(Event::Refunded(Refunded { order_id }));
        }
    }

    #[generate_trait]
    pub impl InternalFunctions of InternalFunctionsTrait {
        /// @notice  Internal function to initiate an order for an atomic swap.
        /// @dev     This function is called internally to create a new order for an atomic swap.
        ///          It checks that the initiator and redeemer addresses are different and that
        ///          there is no duplicate order.
        ///          It creates a new order with the provided parameters and stores it in the
        ///          'orders' mapping.
        ///          It emits an 'Initiated' event with the order ID, secret hash, and amount.
        ///          It transfers the specified amount of tokens from the initiator to the contract
        ///          address.
        /// @param   initiator  Address of the initiator of the atomic swap.
        /// @param   redeemer  Address of the redeemer of the atomic swap.
        /// @param   secret_hash  Hash of the secret used for redemption.
        /// @param   timelock  Timelock block number for the atomic swap.
        /// @param   amount  Amount of tokens to be traded in the atomic swap.
        fn _initiate(
            ref self: ContractState,
            funder_: ContractAddress,
            initiator_: ContractAddress,
            redeemer_: ContractAddress,
            timelock_: u128,
            amount_: u256,
            secret_hash_: [u32; 8],
        ) {
            assert!(initiator_ != redeemer_, "HTLC: same initiator & redeemer");

            let initiator_address: felt252 = initiator_.try_into().unwrap();
            let order_id = self.generate_order_id(CHAIN_ID, secret_hash_, initiator_address);

            let order: Order = self.orders.read(order_id);
            assert!(!order.redeemer.is_non_zero(), "HTLC: duplicate order");

            let block_info = get_block_info().unbox();
            let current_block = block_info.block_number;

            let create_order = Order {
                is_fulfilled: false,
                initiator: initiator_,
                redeemer: redeemer_,
                initiated_at: current_block.into(),
                timelock: timelock_,
                amount: amount_,
            };
            self.orders.write(order_id, create_order);

            let balance = self.token.read().balance_of(funder_);
            assert!(balance >= amount_, "ERC20: Insufficient balance");

            let allowance = self.token.read().allowance(funder_, get_contract_address());
            assert!(allowance >= amount_, "ERC20: insufficient allowance");

            let transfer_result = self
                .token
                .read()
                .transfer_from(funder_, get_contract_address(), amount_);
            assert!(transfer_result, "ERC20: Transfer failed");

            self
                .emit(
                    Event::Initiated(
                        Initiated { order_id, secret_hash: secret_hash_, amount: amount_ },
                    ),
                );
        }

        /// @notice  Generates a unique swap ID based on chain ID, asset address, and user address.
        /// @dev     Uses the Poseidon hash function to ensure uniqueness and security.
        ///
        /// @param   chain_id       Chain ID where the swap is being executed.
        /// @param   asset_address  Address of the asset being swapped.
        /// @param   user_address   Address of the user initiating the swap.
        fn generate_order_id(
            self: @ContractState,
            chain_id: felt252,
            secret_hash: [u32; 8],
            initiator_address: felt252,
        ) -> felt252 {
            let mut state = PoseidonTrait::new();
            state = state.update(chain_id);
            state = state.update_with(secret_hash);
            state = state.update(initiator_address);
            state.finalize()
        }
    }

    #[generate_trait]
    impl AssertsImpl of AssertsTrait {
        /// @notice  .
        /// @dev     Provides checks to ensure:
        ///              1. Redeemer is not the null address.
        ///              3. Timelock is greater than 0.
        ///              4. Amount is not zero.
        /// @param   redeemer  Contract address of the redeemer.
        /// @param   timelock  Timelock period for the HTLC order.
        /// @param   amount  Amount of tokens to trade.
        fn safe_params(
            self: @ContractState, redeemer: ContractAddress, timelock: u128, amount: u256,
        ) {
            assert!(redeemer.is_non_zero(), "HTLC: zero address redeemer");
            assert!(timelock > 0, "HTLC: zero timelock");
            assert!(amount > 0, "HTLC: zero amount");
        }
    }
}
