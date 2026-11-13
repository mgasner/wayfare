-- places.refreshSlots counts a person's live reads in the last minute.
create index interaction_owner_kind_at on interaction (owner, kind, at);
