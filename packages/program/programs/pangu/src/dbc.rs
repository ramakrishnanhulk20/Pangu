use anchor_lang::prelude::*;

use crate::errors::PanguError;

/// Meteora's Dynamic Bonding Curve program. The same address on mainnet and devnet.
/// Source: ARCHITECTURE.md, "Fixed facts from DBC", verified on mainnet 21 Sep 2026.
pub const DBC_PROGRAM_ID: Pubkey =
    Pubkey::from_str_const("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");

/// Anchor discriminator of DBC's `TransferHookPool` account.
/// Source: ARCHITECTURE.md, "Fixed facts from DBC".
pub const HOOK_POOL_DISCRIMINATOR: [u8; 8] = [237, 219, 184, 23, 42, 189, 169, 35];

/// Exact byte length of a `TransferHookPool` account. A pool of any other length is
/// a different account type, so the offsets below would read the wrong fields.
/// Source: ARCHITECTURE.md, "Fixed facts from DBC".
pub const HOOK_POOL_LEN: usize = 424;

/// Anchor discriminator and exact length of DBC's `ConfigWithTransferHook`.
/// Source: ARCHITECTURE.md, "Fixed facts from DBC".
pub const HOOK_CONFIG_DISCRIMINATOR: [u8; 8] = [40, 220, 194, 251, 41, 199, 123, 253];
pub const HOOK_CONFIG_LEN: usize = 1128;

/// Offsets of the fields Pangu reads out of a `TransferHookPool`.
/// Source: ARCHITECTURE.md, "Offsets inside the pool account", and the field order
/// of `PoolState` in reference/dynamic-bonding-curve state/virtual_pool.rs.
const CONFIG_OFFSET: usize = 72;
const CREATOR_OFFSET: usize = 104;
const BASE_MINT_OFFSET: usize = 136;
const BASE_VAULT_OFFSET: usize = 168;
const SQRT_PRICE_OFFSET: usize = 280;

/// `quote_mint` is the first field of `PoolConfig`, so it sits right behind the
/// account discriminator. Source: reference/dynamic-bonding-curve state/config.rs.
const CONFIG_QUOTE_MINT_OFFSET: usize = 8;

/// `collect_fee_mode` sits 224 bytes into `PoolConfig`, behind the three mints and
/// vesting blocks and the two paddings, which is byte 232 of the account. The
/// arithmetic is written out in docs/measurements/review-fixes.md and checked
/// against a real mainnet template in the test at the bottom of this file.
/// Source: reference/dynamic-bonding-curve state/config.rs, `PoolConfig`.
const CONFIG_COLLECT_FEE_MODE_OFFSET: usize = 232;

/// The only fee mode Pangu will open a sale on. Fees and referral payouts then move
/// the paying token, never the sale token, so no fee ever travels through the hook.
/// Source: reference/dynamic-bonding-curve state/virtual_pool.rs, `CollectFeeMode`.
pub const COLLECT_FEE_MODE_QUOTE_TOKEN: u8 = 0;

/// Seed prefix DBC uses for a pool's token vault.
/// Source: ARCHITECTURE.md, "Base vault address"; docs/RD-HOOK.md Q2c.
pub const TOKEN_VAULT_SEED: &[u8] = b"token_vault";

/// The facts Pangu needs from a DBC hook pool.
pub struct HookPool {
    /// The launch template this pool runs on. The price band reads the paying
    /// token's decimals out of it at creation.
    pub config: Pubkey,
    pub creator: Pubkey,
    pub base_mint: Pubkey,
    pub base_vault: Pubkey,
    /// The curve price as Q64.64, meaning quote raw units per base raw unit under
    /// a square root. During a swap DBC writes this before it releases the pool,
    /// so the hook reads the price the buy just produced.
    pub sqrt_price: u128,
}

/// Reads a DBC hook pool account.
///
/// Proves, before any field is read, that the account is owned by DBC, is exactly
/// the length of a `TransferHookPool`, and carries that account's discriminator.
/// Any of those failing means the offsets would be read against foreign bytes, so
/// the whole account is refused rather than partly trusted.
pub fn parse_hook_pool(info: &AccountInfo) -> Result<HookPool> {
    require_keys_eq!(*info.owner, DBC_PROGRAM_ID, PanguError::NotAHookPool);

    let data = info.try_borrow_data()?;
    require!(data.len() == HOOK_POOL_LEN, PanguError::NotAHookPool);
    require!(data[..8] == HOOK_POOL_DISCRIMINATOR, PanguError::NotAHookPool);

    let mut sqrt_price = [0u8; 16];
    sqrt_price.copy_from_slice(&data[SQRT_PRICE_OFFSET..SQRT_PRICE_OFFSET + 16]);

    Ok(HookPool {
        config: read_pubkey(&data, CONFIG_OFFSET),
        creator: read_pubkey(&data, CREATOR_OFFSET),
        base_mint: read_pubkey(&data, BASE_MINT_OFFSET),
        base_vault: read_pubkey(&data, BASE_VAULT_OFFSET),
        sqrt_price: u128::from_le_bytes(sqrt_price),
    })
}

/// The facts Pangu needs from a DBC launch template.
pub struct HookConfig {
    /// The token buyers pay in. The price band reads its decimals at creation.
    pub quote_mint: Pubkey,
    /// Which side of a trade the pool takes its fees from.
    pub collect_fee_mode: u8,
}

/// Reads a DBC launch template.
///
/// The caller must already have proved that this is the template the pool names.
/// Owner, length and discriminator are proved here, so the offsets can never be
/// read against another program's bytes.
pub fn parse_hook_config(info: &AccountInfo) -> Result<HookConfig> {
    require_keys_eq!(*info.owner, DBC_PROGRAM_ID, PanguError::NotAHookPool);

    let data = info.try_borrow_data()?;
    require!(data.len() == HOOK_CONFIG_LEN, PanguError::NotAHookPool);
    require!(
        data[..8] == HOOK_CONFIG_DISCRIMINATOR,
        PanguError::NotAHookPool
    );

    Ok(HookConfig {
        quote_mint: read_pubkey(&data, CONFIG_QUOTE_MINT_OFFSET),
        collect_fee_mode: data[CONFIG_COLLECT_FEE_MODE_OFFSET],
    })
}

/// The address DBC must have used for this pool's base token vault.
pub fn derive_base_vault(base_mint: &Pubkey, pool: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[TOKEN_VAULT_SEED, base_mint.as_ref(), pool.as_ref()],
        &DBC_PROGRAM_ID,
    )
    .0
}

fn read_pubkey(data: &[u8], offset: usize) -> Pubkey {
    let mut bytes = [0u8; 32];
    bytes.copy_from_slice(&data[offset..offset + 32]);
    Pubkey::new_from_array(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A launch template Meteora's own program wrote on mainnet, dumped with
    /// `solana account 1kcwsh9MLFMe4G8VThPNLM6JsGELiaTYnQaaErTfbcx --output json -u m`.
    const LIVE_MAINNET_CONFIG: &[u8] = include_bytes!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../feeds/live-config.bin"
    ));

    /// What Meteora's SDK reads out of the same bytes, through its own IDL and
    /// Anchor's account coder. Recorded in docs/measurements/review-fixes.md.
    const SDK_QUOTE_MINT: &str = "So11111111111111111111111111111111111111112";
    const SDK_COLLECT_FEE_MODE: u8 = 0;

    fn config_info<'a>(
        key: &'a Pubkey,
        lamports: &'a mut u64,
        data: &'a mut [u8],
        owner: &'a Pubkey,
    ) -> AccountInfo<'a> {
        AccountInfo::new(key, false, false, lamports, data, owner, false)
    }

    /// The offsets are read against bytes nobody in this project wrote, and the
    /// answer is compared with the SDK's answer for the same account.
    #[test]
    fn the_live_mainnet_template_reads_at_the_offsets_we_use() {
        let key = Pubkey::from_str_const("1kcwsh9MLFMe4G8VThPNLM6JsGELiaTYnQaaErTfbcx");
        let mut lamports = 8_741_760u64;
        let mut data = LIVE_MAINNET_CONFIG.to_vec();
        assert_eq!(data.len(), HOOK_CONFIG_LEN);

        let owner = DBC_PROGRAM_ID;
        let info = config_info(&key, &mut lamports, &mut data, &owner);
        let config = parse_hook_config(&info).unwrap();

        assert_eq!(config.quote_mint, Pubkey::from_str_const(SDK_QUOTE_MINT));
        assert_eq!(config.collect_fee_mode, SDK_COLLECT_FEE_MODE);
        assert_eq!(config.collect_fee_mode, COLLECT_FEE_MODE_QUOTE_TOKEN);
    }

    #[test]
    fn a_template_owned_by_anyone_else_is_refused() {
        let key = Pubkey::from_str_const("1kcwsh9MLFMe4G8VThPNLM6JsGELiaTYnQaaErTfbcx");
        let mut lamports = 8_741_760u64;
        let mut data = LIVE_MAINNET_CONFIG.to_vec();

        let owner = Pubkey::new_unique();
        let info = config_info(&key, &mut lamports, &mut data, &owner);
        assert!(parse_hook_config(&info).is_err());
    }

    /// The fee mode is one byte, so the test that matters is that it is read from
    /// the byte the template really carries it in.
    #[test]
    fn the_output_token_fee_mode_reads_as_output_token() {
        let key = Pubkey::from_str_const("1kcwsh9MLFMe4G8VThPNLM6JsGELiaTYnQaaErTfbcx");
        let mut lamports = 8_741_760u64;
        let mut data = LIVE_MAINNET_CONFIG.to_vec();
        data[CONFIG_COLLECT_FEE_MODE_OFFSET] = 1;

        let owner = DBC_PROGRAM_ID;
        let info = config_info(&key, &mut lamports, &mut data, &owner);
        let config = parse_hook_config(&info).unwrap();
        assert_ne!(config.collect_fee_mode, COLLECT_FEE_MODE_QUOTE_TOKEN);
    }
}
