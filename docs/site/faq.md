---
title: FAQ
description: Fourteen questions a judge or an issuer would ask about Pangu, mainnet included.
---

**Is this on mainnet?**
No, and it is ready to be. The mainnet build is made reproducibly and its hash recorded, the deploy is one guarded command a person runs with their own key, and every step of it, the sales and the upgrade key's handover included, was rehearsed on a forked copy of mainnet on 23 September 2026. The runbook is `docs/deploy/mainnet.md` in the repository, and the mainnet page of these docs says what changes there.

**What would mainnet cost?**
The deploy is almost all rent, locked in the program's account for as long as the program exists, plus a temporary deposit for the upload that comes back in the same transaction that puts the code in place. The exact figures, read from mainnet's own rent, are in the runbook, and the deploy script refuses to start until the deployer's wallet holds enough. After that, the costs fall on whoever acts: about 0.019 SOL for an issuer to open a sale, most of it rent; Solana's ordinary network fee for a buy or a sell; about 0.000035 SOL for each price refresh.

**Who holds the upgrade key, and what is the plan for it?**
The team holds it today, on devnet, and says so openly: it can replace the program's code, even during a live sale. On mainnet the team keeps it at launch, then hands it to a Squads v4 multisig of two of three keys, so no single key can change the code, and freezes the program for good once an independent audit is done. The handover and an upgrade through the multisig were both rehearsed on the fork against Squads' real mainnet program.

**Can I launch my own sale?**
Yes. `/launch` opens one from a single form on devnet today: the token, what buyers pay in, the raise, the cap on one wallet, who may buy, an optional price ceiling and an offering period, with an optional logo. It takes two transactions and about 0.0193 SOL, and the sale appears on `/sales` straight away.

**Can a holder ever get trapped, unable to sell?**
No. Selling back to the pool is a path that reads nothing that could be missing: not the cap, not the approval list, not the price. It is designed so that nothing, including a bug in another part of the program, can block it. This is proven by a real devnet transaction where a revoked wallet still sold successfully, and by 1,330 simulated exit sells inside the randomized attack tests.

**What happens if the price feed goes stale?**
Buying pauses. Every buy in a banded sale needs a price that is fresh, positive, and from the right source; if it is not, the buy is refused. This is also what a closed stock market looks like, since Apple's exchange price stops updating outside trading hours. A sale banded on AAPLx, the tokenized Apple share, has a price all week. Selling is never affected.

**Who can mint more of the sale token?**
Nobody, once the sale is open. A sale refuses to open at all on a token whose minting power has not already been given up. This was a finding from a code review: without it, an issuer could have minted new tokens straight into any wallet, skipping the cap and the approval list entirely.

**What happens when the sale finishes?**
Meteora's own code removes Pangu from the token, permanently, in the very same trade that completes the sale. From that moment the token trades freely with no rules from Pangu at all, and the leftover liquidity moves into a fresh Meteora trading pool automatically. If the sale's offering period ends before the curve fills, every rule lifts then instead, so a slow sale cannot hold its buyers forever. A sale opened with no end keeps its rules until graduation.

**Can the issuer change the rules mid-sale?**
No. A sale's cap, its approval mode, its price ceiling, its paying token and the end of its offering period are all set once, when the sale is created, and there is no instruction in the program that can change them afterward.

**Why a cap per wallet, and not per person?**
Because a wallet is the only identity Solana itself can verify. Enforcing a real per-person limit needs a real identity check behind it, which is exactly what the credential mode and the verifier console are for: a wallet only counts as approved if a trusted verifier has issued it a credential. Without that, a cap is a speed bump against casual bot behaviour, not a hard guarantee against one person using many wallets.

**What does a buy cost?**
Solana's ordinary 5,000 lamport network fee. Measured on a forked copy of mainnet on 23 September 2026 (`docs/measurements/mainnet-rehearsal.md`), a buy through Pangu's rules ran between about 114,000 and 163,000 compute units depending on the sale and the point on the curve, and a sell about 84,000 to 100,000, well inside Solana's limits. The first buy also opens the buyer's own record, whose small rent deposit comes back when the record is closed.

**What did the forgery attempts on the price feed show?**
Four separate attempts to write a fake or replayed stock price into the account a banded sale reads were all refused on Solana devnet: a signature from a key that was not a real oracle, altered price bytes, a genuine update aimed at the wrong stock, and a genuine but aged-out update replayed later. None of them changed the account or cost more than a transaction fee. Full write-up on the security page.

**Can a sale be paid in a tokenized stock?**
Yes, without a price ceiling. The fork rehearsal opened, bought into and sold out of a sale paid in AAPLx, and on mainnet the launch page offers AAPLx, TSLAx, NVDAx and SPYx, each while its Meteora token badge reads back from the chain. A ceiling needs a dollar, so the program refuses one on a sale paid in a stock.

**What is next?**
The mainnet deploy, which is the team's to run with its own key; the upgrade key's move to a multisig; and, as a further step named in the project's own plan, a fee-sharing arrangement that would let a verifier who approves buyers earn a share of the issuer's fees, giving verifiers a real reason to keep approving buyers after the hackathon ends.
