use core::num::traits::Zero;
use snforge_std::{
    ContractClassTrait, DeclareResultTrait, declare, start_cheat_caller_address,
    stop_cheat_caller_address,
};
use starknet::{ClassHash, ContractAddress};
use crate::interface::{IRegistryDispatcher, IRegistryDispatcherTrait};

const ADMIN: felt252 = 0x1111;
const OWNER: felt252 = 0x123;

fn deploy_contract(name: ByteArray, calldata: @Array<felt252>) -> (ContractAddress, ClassHash) {
    let contract = declare(name).unwrap().contract_class();
    let (contract_address, _) = contract.deploy(calldata).unwrap();
    (contract_address, *contract.class_hash)
}

fn setup() -> (IRegistryDispatcher, ClassHash) {
    // owner is admin
    let (registry_address, _registry_class_hash) = deploy_contract("registry", @array![ADMIN]);

    // Deploy UDA contract to get its class hash
    let (_uda_address, uda_class_hash) = deploy_contract("UniqueDepositAddress", @array![OWNER]);

    // registry stuff
    let registry_disp = IRegistryDispatcher { contract_address: registry_address };

    (registry_disp, uda_class_hash)
}

#[test]
fn test_basic_deployment() {
    let (_registry_disp, _uda_class_hash) = setup();
}

#[test]
fn test_registry_owner() {
    let (registry_disp, _uda_class_hash) = setup();

    let owner = registry_disp.get_owner();
    assert!(owner == ADMIN.try_into().unwrap(), "Owner should be ADMIN");
}

#[test]
fn test_set_impl_uda() {
    let (registry_disp, uda_class_hash) = setup();

    // fake owner
    start_cheat_caller_address(registry_disp.contract_address, ADMIN.try_into().unwrap());

    let class_felt: felt252 = uda_class_hash.into();
    let uda_impl_address: ContractAddress = class_felt.try_into().unwrap();
    registry_disp.set_impl_uda(uda_impl_address);

    let stored_impl = registry_disp.get_impl_uda();
    assert!(stored_impl == uda_impl_address, "UDA impl should be set");

    stop_cheat_caller_address(registry_disp.contract_address);
}

#[test]
fn test_add_htlc() {
    let (registry_disp, _uda_class_hash) = setup();

    // fake owner
    start_cheat_caller_address(registry_disp.contract_address, ADMIN.try_into().unwrap());

    let dummy_htlc: ContractAddress = 0x999.try_into().unwrap();
    let dummy_token: ContractAddress = 0x888.try_into().unwrap();

    registry_disp.add_htlc(dummy_htlc, dummy_token);

    let stored_htlc = registry_disp.get_htlc_for_token(dummy_token);
    assert!(stored_htlc == dummy_htlc, "HTLC should be stored for token");

    stop_cheat_caller_address(registry_disp.contract_address);
}

#[test]
fn test_address_prediction() {
    let (registry_disp, uda_class_hash) = setup();

    // fake owner
    start_cheat_caller_address(registry_disp.contract_address, ADMIN.try_into().unwrap());

    let dummy_htlc: ContractAddress = 0x999.try_into().unwrap();
    let dummy_token: ContractAddress = 0x888.try_into().unwrap();

    registry_disp.add_htlc(dummy_htlc, dummy_token);

    let class_felt: felt252 = uda_class_hash.into();
    let uda_impl_address: ContractAddress = class_felt.try_into().unwrap();
    registry_disp.set_impl_uda(uda_impl_address);

    stop_cheat_caller_address(registry_disp.contract_address);

    let refund_address = OWNER.try_into().unwrap();
    let redeemer: ContractAddress = 0xdef.try_into().unwrap();
    let timelock: u128 = 1000;
    let secret_hash: [u32; 8] = [1, 2, 3, 4, 5, 6, 7, 8];
    let amount: u256 = 100;
    let destination_data: Array<felt252> = array![];

    let predicted_address = registry_disp
        .get_address(
            dummy_token,
            refund_address,
            redeemer,
            timelock,
            secret_hash,
            amount,
            destination_data.span(),
        );

    assert!(!predicted_address.is_zero(), "Predicted address should not be zero");

    let predicted_address_2 = registry_disp
        .get_address(
            dummy_token,
            refund_address,
            redeemer,
            timelock,
            secret_hash,
            amount,
            destination_data.span(),
        );

    assert!(predicted_address == predicted_address_2, "should be same for same values/params");
}

#[test]
fn test_prediction_vs_deployment_should_fail_and_will_fail_due_to_checks() {
    let (registry_disp, uda_class_hash) = setup();

    // fake owner
    start_cheat_caller_address(registry_disp.contract_address, ADMIN.try_into().unwrap());

    let dummy_htlc: ContractAddress = 0x999.try_into().unwrap();
    let dummy_token: ContractAddress = 0x888.try_into().unwrap();

    registry_disp.add_htlc(dummy_htlc, dummy_token);

    let class_felt: felt252 = uda_class_hash.into();
    let uda_impl_address: ContractAddress = class_felt.try_into().unwrap();
    registry_disp.set_impl_uda(uda_impl_address);

    stop_cheat_caller_address(registry_disp.contract_address);

    let refund_address = OWNER.try_into().unwrap();
    let redeemer: ContractAddress = 0xdef.try_into().unwrap();
    let timelock: u128 = 1000;
    let secret_hash: [u32; 8] = [1, 2, 3, 4, 5, 6, 7, 8];
    let amount: u256 = 100;
    let destination_data: Array<felt252> = array![];

    // Step 1: Predict the address
    let predicted_address = registry_disp
        .get_address(
            dummy_token,
            refund_address,
            redeemer,
            timelock,
            secret_hash,
            amount,
            destination_data.span(),
        );

    // Step 2: Actually deploy and get the real address
    let actual_address = registry_disp
        .create_swap_address(
            dummy_token,
            refund_address,
            redeemer,
            timelock,
            secret_hash,
            amount,
            destination_data.span(),
        );

    // Step 3: Compare prediction vs reality
    assert!(predicted_address == actual_address, "Prediction should match deployment!");
}
