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
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        htlc_address: ContractAddress,
        refund_address: ContractAddress,
        redeemer: ContractAddress,
        timelock: u128,
        secret_hash: [u32; 8],
        amount: u256,
        destination_data: Span<felt252>,
    ) {
        self.refund_address.write(refund_address);

        let htlc = IHTLCDispatcher { contract_address: htlc_address };
        let token = htlc.token();

        // Approve
        let erc20 = IERC20Dispatcher { contract_address: token };
        erc20.approve(htlc_address, amount);

        let dest_array: Array<felt252> = destination_data.into();
        htlc
            .initiate_on_behalf_with_destination_data(
                refund_address, // initiator
                redeemer, // redeemer
                timelock, // timelock
                amount, // amount
                secret_hash, // secret_hash
                dest_array // destination_data
            );
    }

    #[abi(embed_v0)]
    impl UniqueDepositAddressImpl of IUniqueDepositAddress<ContractState> {
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

