-- Credits belong to the user. Balance = sum(amount_cents); Stripe top-ups and booking debits add rows.
create table credit_ledger (
  id text primary key,
  owner text not null references app_user,
  amount_cents integer not null,     -- positive: top-up, grant or refund; negative: debit
  kind text not null check (kind in ('topup', 'grant', 'debit', 'refund', 'migration')),
  ref text,                          -- Stripe payment intent, meal id
  created_at text not null
);
create index credit_ledger_owner on credit_ledger (owner, created_at);

-- Each trip held a copy of the wizard's credits value; the largest per owner becomes their opening balance.
insert into credit_ledger (id, owner, amount_cents, kind, ref, created_at)
select lower(hex(randomblob(16))), owner, cast(round(max(json_extract(booking, '$.credits_usd')) * 100) as integer), 'migration', null,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
from trip
where json_extract(booking, '$.credits_usd') > 0
group by owner;

update trip set booking = json_remove(booking, '$.credits_usd') where booking is not null;
