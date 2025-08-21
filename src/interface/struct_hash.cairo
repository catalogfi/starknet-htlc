use core::hash::{HashStateExTrait, HashStateTrait};
use core::poseidon::PoseidonTrait;
use starknet::ContractAddress;
use crate::htlc::HTLC::{
    INITIATE_TYPE_HASH, INSTANT_REFUND_TYPE_HASH, NAME, U256_TYPE_HASH, VERSION,
};
use crate::interface::sn_domain::StarknetDomain;
use crate::interface::{IMessageHash, IStructHash};

#[derive(Drop, Serde, Debug)]
pub struct Initiate {
    pub redeemer: ContractAddress,
    pub amount: u256,
    pub timelock: u128,
    pub secretHash: [u32; 8],
    pub verifyingContract: ContractAddress,
}

#[derive(Drop, Copy, Hash, Serde, Debug)]
pub struct instantRefund {
    pub orderID: felt252,
    pub verifyingContract: ContractAddress,
}

pub impl MessageHashInitiate of IMessageHash<Initiate> {
    fn get_message_hash(self: @Initiate, chain_id: felt252, signer: ContractAddress) -> felt252 {
        let domain = StarknetDomain {
            name: NAME, version: VERSION, chain_id: chain_id, revision: 1,
        };
        let mut state = PoseidonTrait::new();
        state = state.update_with('StarkNet Message');
        state = state.update_with(domain.get_struct_hash());
        state = state.update_with(signer);
        state = state.update_with(self.get_struct_hash());
        state.finalize()
    }
}

pub impl StructHashInitiate of IStructHash<Initiate> {
    fn get_struct_hash(self: @Initiate) -> felt252 {
        let mut state = PoseidonTrait::new();
        state = state.update_with(INITIATE_TYPE_HASH);
        state = state.update_with(*self.redeemer);
        state = state.update_with(self.amount.get_struct_hash());
        state = state.update_with(*self.timelock);
        state = state.update_with(self.secretHash.span().get_struct_hash());
        state = state.update_with(*self.verifyingContract);
        state.finalize()
    }
}

pub impl StructHashU256 of IStructHash<u256> {
    fn get_struct_hash(self: @u256) -> felt252 {
        let mut state = PoseidonTrait::new();
        state = state.update_with(U256_TYPE_HASH);
        state = state.update_with(*self);
        state.finalize()
    }
}

pub impl StructHashSpanU32 of IStructHash<Span<u32>> {
    fn get_struct_hash(self: @Span<u32>) -> felt252 {
        let mut state = PoseidonTrait::new();
        for el in (*self) {
            state = state.update_with(*el);
        }
        state.finalize()
    }
}

pub impl MessageHashInstantRefund of IMessageHash<instantRefund> {
    fn get_message_hash(
        self: @instantRefund, chain_id: felt252, signer: ContractAddress,
    ) -> felt252 {
        let domain = StarknetDomain {
            name: NAME, version: VERSION, chain_id: chain_id, revision: 1,
        };
        let mut state = PoseidonTrait::new();
        state = state.update_with('StarkNet Message');
        state = state.update_with(domain.get_struct_hash());
        state = state.update_with(signer);
        state = state.update_with(self.get_struct_hash());
        state.finalize()
    }
}

pub impl StructHashInstantRefund of IStructHash<instantRefund> {
    fn get_struct_hash(self: @instantRefund) -> felt252 {
        let mut state = PoseidonTrait::new();
        state = state.update_with(INSTANT_REFUND_TYPE_HASH);
        state = state.update_with(*self.orderID);
        state = state.update_with(*self.verifyingContract);
        state.finalize()
    }
}
