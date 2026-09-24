#!/usr/bin/env bash
# Provision + deploy LDL Workspace on Cloudflare (D1 + R2 + Workers static assets).
# Idempotent: safe to run on every deploy. Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME=$(sed -n 's/^database_name = "\(.*\)"/\1/p' wrangler.toml)
BUCKET=$(sed -n 's/^bucket_name = "\(.*\)"/\1/p' wrangler.toml)
WR="npx wrangler"

echo "==> D1 database: $DB_NAME"
db_id() { $WR d1 list --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const x=JSON.parse(s).find(d=>d.name===process.argv[1]);process.stdout.write(x?x.uuid:'')})" "$DB_NAME"; }
ID=$(db_id)
if [ -z "$ID" ]; then
  $WR d1 create "$DB_NAME"
  ID=$(db_id)
fi
[ -n "$ID" ] || { echo "Không lấy được database_id"; exit 1; }
sed -i.bak "s/^database_id = \".*\"/database_id = \"$ID\"/" wrangler.toml && rm -f wrangler.toml.bak
echo "    database_id = $ID"

echo "==> R2 bucket: $BUCKET"
if ! OUT=$($WR r2 bucket create "$BUCKET" 2>&1); then
  if echo "$OUT" | grep -qiE "already exists|10004"; then
    echo "    Bucket đã tồn tại"
  else
    echo "$OUT"
    echo "::error::Không tạo được R2 bucket. Hãy bật R2 trong Cloudflare Dashboard (R2 Object Storage → Enable) rồi chạy lại."
    exit 1
  fi
fi

echo "==> Migrations"
$WR d1 migrations apply DB --remote

echo "==> Dữ liệu ban đầu"
USERS=$($WR d1 execute DB --remote --json --command "SELECT COUNT(*) AS n FROM users" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(String(JSON.parse(s)[0].results[0].n)))")
if [ "$USERS" = "0" ]; then
  node src/seed.js --sql > /tmp/ldl-seed.sql
  $WR d1 execute DB --remote --yes --file /tmp/ldl-seed.sql
  echo "    Đã tạo dữ liệu mẫu (admin / 123456)"
else
  echo "    Đã có $USERS người dùng — giữ nguyên dữ liệu"
fi

echo "==> Build giao diện"
npm --prefix ../client ci
npm --prefix ../client run build

echo "==> Deploy Worker"
$WR deploy
