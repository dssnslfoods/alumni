/**
 * Fix search index fields to use legalFirstName/legalLastName.
 *
 *   FIREBASE_ENABLED=true \
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *   node scripts/fix-search-index.mjs
 */
import { assertRuntimeConfig, config } from "../server/lib/env.js";
import { usingFirestore, listDocs, updateDoc } from "../server/lib/db.js";
import { searchKey } from "../server/domain/alumni.js";

assertRuntimeConfig();

console.log(`ที่เก็บข้อมูล: ${usingFirestore ? "Firestore" : "ไฟล์ JSON ที่ data/db"}`);

const ALUMNI = config.collections.alumni;
const PAGE = 2000;
let fixed = 0;
let total = 0;

for (let offset = 0; ; offset += PAGE) {
  const page = await listDocs(ALUMNI, { limit: PAGE, offset });
  total += page.length;

  for (const record of page) {
    const expectedFirst = searchKey(record.legalFirstName);
    const expectedLast = searchKey(record.legalLastName);
    const expectedFull = `${expectedFirst}${expectedLast}`;

    if (record.searchFirst !== expectedFirst || record.searchLast !== expectedLast || record.searchFull !== expectedFull) {
      console.log(`  fix: ${record.legalFirstName} ${record.legalLastName} (batch ${record.batch}) — searchFirst: ${record.searchFirst} → ${expectedFirst}`);
      await updateDoc(ALUMNI, record.id, {
        searchFirst: expectedFirst,
        searchLast: expectedLast,
        searchFull: expectedFull
      });
      fixed++;
    }
  }

  if (page.length < PAGE) break;
}

console.log(`\nเสร็จ: ตรวจ ${total} records, แก้ไข ${fixed} records`);
