#[derive(Drop, starknet::Event)]
pub struct Initiated {
    #[key]
    pub order_id: felt252,
    pub secret_hash: [u32; 8],
    pub amount: u256,
}

#[derive(Drop, starknet::Event)]
pub struct InitiatedWithDestinationData {
    #[key]
    pub order_id: felt252,
    pub secret_hash: [u32; 8],
    pub amount: u256,
    pub destination_data: Array<felt252>,
}

#[derive(Drop, starknet::Event)]
pub struct Redeemed {
    #[key]
    pub order_id: felt252,
    pub secret_hash: [u32; 8],
    pub secret: Array<u32>,
}

#[derive(Drop, starknet::Event)]
pub struct Refunded {
    #[key]
    pub order_id: felt252,
}
