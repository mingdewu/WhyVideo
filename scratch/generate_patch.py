# Script to patch ui-server.mjs with Writer Workshop
import re
import os

target_file = 'packages/qc-tools/ui-server.mjs'
with open(target_file, 'r', encoding='utf-8') as f:
    code = f.read()

print("Original length:", len(code))
