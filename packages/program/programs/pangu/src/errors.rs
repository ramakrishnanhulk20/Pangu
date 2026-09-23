use anchor_lang::prelude::*;

#[error_code]
pub enum PanguError {
    #[msg("Token-2022 is not mid-transfer on both token accounts")]
    NotTransferring,
    #[msg("the receiving token account's owner can still be changed")]
    ReceivingAccountOwnerCanChange,
    #[msg("the account does not belong to this sale's mint")]
    WrongMint,
    #[msg("the buyer record is not the one for this wallet")]
    WrongBuyerRecord,
    #[msg("this wallet has no buyer record yet")]
    BuyerRecordMissing,
    #[msg("this wallet is not on the issuer's approved list")]
    NotApproved,
    #[msg("the attestation is not valid for this wallet, credential and schema")]
    CredentialInvalid,
    #[msg("the attestation has expired")]
    CredentialExpired,
    #[msg("the key that signed the attestation is no longer an authorized signer")]
    CredentialSignerNotAuthorized,
    #[msg("this buy would take the wallet over the per-wallet cap")]
    OverCap,
    #[msg("the token cannot move between wallets while the sale is running")]
    WalletToWalletDuringSale,
    #[msg("the reference price is too old, missing or not a positive number")]
    PriceStale,
    #[msg("the price is outside the allowed band")]
    PriceOutsideBand,
    #[msg("the price account is not the one named in the rules, or does not hold a usable price")]
    WrongPriceAccount,
    #[msg("the price update has not been signed by two thirds of the guardians")]
    PriceNotFullyVerified,
    #[msg("the price carries a wider confidence interval than this sale accepts")]
    PriceTooUncertain,
    #[msg("the signer did not create this pool")]
    NotPoolCreator,
    #[msg("the account is not a DBC transfer-hook pool")]
    NotAHookPool,
    #[msg("the mint's transfer hook does not name this program")]
    HookProgramMismatch,
    #[msg("someone can still mint this token, which would go straight past the cap")]
    MintAuthorityStillSet,
    #[msg("the launch template is not the one this pool was opened on")]
    WrongLaunchTemplate,
    #[msg("the launch template collects fees in the sale token instead of the paying token")]
    FeesNotInQuoteToken,
    #[msg("the cap must be above zero")]
    ZeroCap,
    #[msg("that access mode is not available")]
    InvalidAccessMode,
    #[msg("the price band settings are incomplete, out of range, or set on a sale that has no band")]
    InvalidBand,
    #[msg("the sale is still running, the mint still names this program as its hook")]
    SaleStillRunning,
    #[msg("only the issuer can do this")]
    NotIssuer,
    #[msg("the counter would overflow")]
    MathOverflow,
    #[msg("these sale rules were written by another layout of the program")]
    WrongLayoutVersion,
    #[msg("a price band needs buyers to pay in a dollar token on this network's list")]
    BandNeedsDollarQuote,
    #[msg("the issuer can freeze the paying token, which would let them stop sellers being paid")]
    IssuerControlsPayingToken,
    #[msg("the cap is at or above everything the curve sells, so it limits nobody")]
    CapCoversWholeSale,
    #[msg("the offering period would end at a time that has already passed")]
    EndInThePast,
}
