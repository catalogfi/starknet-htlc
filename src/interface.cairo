pub mod sn_domain;
pub mod struct_hash;
pub mod events;
use starknet::ContractAddress;
use crate::htlc::HTLC::Order;

#[starknet::interface]
pub trait IHTLC<TContractState> {
    fn token(self: @TContractState) -> ContractAddress;

    fn get_order(self: @TContractState, order_id: felt252) -> Order;

    fn initiate(
        ref self: TContractState,
        redeemer: ContractAddress,
        timelock: u128,
        amount: u256,
        secret_hash: [u32; 8],
    );

    fn initiate_on_behalf(
        ref self: TContractState,
        initiator: ContractAddress,
        redeemer: ContractAddress,
        timelock: u128,
        amount: u256,
        secret_hash: [u32; 8],
    );

    fn initiate_with_signature(
        ref self: TContractState,
        initiator: ContractAddress,
        redeemer: ContractAddress,
        timelock: u128,
        amount: u256,
        secret_hash: [u32; 8],
        signature: Array<felt252>,
    );

    fn redeem(ref self: TContractState, order_id: felt252, secret: Array<u32>);

    fn refund(ref self: TContractState, order_id: felt252);

    fn instant_refund(ref self: TContractState, order_id: felt252, signature: Array<felt252>);
}

pub trait IMessageHash<T> {
    fn get_message_hash(self: @T, chain_id: felt252, signer: ContractAddress) -> felt252;
}

pub trait IStructHash<T> {
    fn get_struct_hash(self: @T) -> felt252;
}
