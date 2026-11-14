#!/usr/bin/env node
// Run before every release: records the fingerprint of each shipped file in
// src/known-hashes.json so `dybs-skills update` can tell an untouched install
// of this version from a user's edit. Append-only; never delete entries.
import { recordHashes } from '../src/update.mjs';

const added = recordHashes();
console.log(added ? `Recorded ${added} new file hash(es) in src/known-hashes.json.` : 'No new hashes; src/known-hashes.json is current.');
