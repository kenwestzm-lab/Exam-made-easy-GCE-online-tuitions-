#!/bin/bash
ADMIN_TOKEN=$(curl -s -X POST https://peace-mindset-api.onrender.com/api/auth/login -H "Content-Type: application/json" -d '{"email":"kenwestzm@gmail.com","password":"Ken2004west#"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")
echo "TOKEN_OK"
echo "----"
curl -s https://peace-mindset-api.onrender.com/api/ai-tokens/payments/all -H "Authorization: Bearer $ADMIN_TOKEN"
echo ""
echo "----DONE----"
