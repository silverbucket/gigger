#!/bin/sh
# Self-signed TLS certificate for the Mailpit sink in the test stack. Sockethub's
# email platform refuses plain-text and untrusted servers, so the same file is
# trusted by the Sockethub container through NODE_EXTRA_CA_CERTS.
set -eu
dir="$(dirname "$0")/../test/certs"
mkdir -p "$dir"
[ -f "$dir/cert.pem" ] && [ -f "$dir/key.pem" ] && exit 0
openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj /CN=mailpit \
  -addext subjectAltName=DNS:mailpit -keyout "$dir/key.pem" -out "$dir/cert.pem" 2>/dev/null
chmod 644 "$dir/key.pem" "$dir/cert.pem"
