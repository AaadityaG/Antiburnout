import sys
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, r"C:\Code Projects\antiburnout.ai\backend")

from kb.extractor import extract_text
from kb.vector_store import chunk_text, CHUNK_SIZE, CHUNK_OVERLAP

md_path = r"C:\Code Projects\antiburnout.ai\knowledge-base-docs\kb-burnout-tips.md"

# Show raw file content first
with open(md_path, "r", encoding="utf-8") as f:
    raw = f.read()

raw_words = raw.split()
print(f"=== RAW MD FILE ===")
print(f"Chars: {len(raw)}")
print(f"Words: {len(raw_words)}")
print(f"Lines: {len(raw.splitlines())}")

# Show the full content
print(f"\n--- FULL CONTENT ---")
print(raw)
print(f"--- END ---")

# Extract (with markdown stripping)
text = extract_text(md_path)
stripped_words = text.split()
print(f"\n=== AFTER EXTRACTION (markdown stripped) ===")
print(f"Chars: {len(text)}")
print(f"Words: {len(stripped_words)}")
print(f"Words lost to stripping: {len(raw_words) - len(stripped_words)}")

# Show stripped content
print(f"\n--- STRIPPED CONTENT ---")
print(text)
print(f"--- END ---")

# Chunk it
chunks = chunk_text(text)
print(f"\n=== CHUNKING ===")
print(f"CHUNK_SIZE: {CHUNK_SIZE}, OVERLAP: {CHUNK_OVERLAP}")
print(f"Total chunks: {len(chunks)}")

if len(chunks) == 1:
    print(f"Single chunk (no splitting needed)")
else:
    for i, chunk in enumerate(chunks):
        w = len(chunk.split())
        print(f"  Chunk {i:2d}: {w:4d} words | {chunk[:100].replace(chr(10), ' ')}...")

# Coverage
covered = set()
for chunk in chunks:
    for w in chunk.split():
        covered.add(w)
missing = set(raw_words) - covered
if missing:
    print(f"\nWords in raw file but NOT in any chunk: {len(missing)}")
    print(f"  Sample: {list(missing)[:20]}")
else:
    print(f"\nAll raw words appear in at least one chunk.")
