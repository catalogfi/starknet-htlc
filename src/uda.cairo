use openzeppelin::token::erc20::interface::{IERC20Dispatcher, IERC20DispatcherTrait};
use starknet::storage::{StoragePointerReadAccess, StoragePointerWriteAccess};
use starknet::{ContractAddress, get_contract_address};
use crate::interface::{IHTLCDispatcher, IHTLCDispatcherTrait, IUniqueDepositAddress};

#[starknet::contract]
mod UniqueDepositAddress {
    use super::*;

    #[storage]
    struct Storage {
        refund_address: ContractAddress,
        initialized: bool,
    }

    #[constructor]
    fn constructor(ref self: ContractState, refund_address: ContractAddress) {
        self.refund_address.write(refund_address);
        self.initialized.write(false);
    }

    #[abi(embed_v0)]
    impl UniqueDepositAddressImpl of IUniqueDepositAddress<ContractState> {
        fn initialize(
            ref self: ContractState,
            htlc_address: ContractAddress,
            redeemer: ContractAddress,
            timelock: u128,
            secret_hash: [u32; 8],
            amount: u256,
            destination_data: Span<felt252>,
        ) {
            assert(!self.initialized.read(), 'UDA: already initialized');
            let refund_addr = self.refund_address.read();

            let htlc = IHTLCDispatcher { contract_address: htlc_address };
            let token = htlc.token();

            // Approve
            let erc20 = IERC20Dispatcher { contract_address: token };
            erc20.approve(htlc_address, amount);

            let dest_array: Array<felt252> = destination_data.into();
            htlc
                .initiate_on_behalf_with_destination_data(
                    refund_addr, redeemer, timelock, amount, secret_hash, dest_array,
                );

            self.initialized.write(true);
        }

        fn recover_token(ref self: ContractState, token: ContractAddress) {
            let refund_addr = self.refund_address.read();

            let erc20 = IERC20Dispatcher { contract_address: token };
            let balance = erc20.balance_of(get_contract_address());
            if balance > 0 {
                erc20.transfer(refund_addr, balance);
            }
        }
    }
}
