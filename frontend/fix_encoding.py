import os

replacements = {
    "Ã³": "o",
    "Ã¡": "a",
    "Ã©": "e",
    "Ã­": "i",
    "Ãº": "u",
    "Ã±": "n",
    "Ãš": "U",
    "Ã": "i",
    "â€¦": "...",
    "â€œ": "\"",
    "â€": "\"",
    "Â·": ".",
    "â†’": "->",
    "â€º": ">",
    "Â": " ",
}

def clean_file(path):
    if not os.path.exists(path):
        print(f"Skipping {path}")
        return
    with open(path, "r", encoding="latin-1") as f:
        content = f.read()

    for old, new in replacements.items():
        content = content.replace(old, new)

    # Also clean some potential double artifacts
    content = content.replace("Ã ", " ")

    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Cleaned {path}")

clean_file("C:/Synco2-main/frontend/src/api.ts")
clean_file("C:/Synco2-main/frontend/app/(coord)/projects/[id]/index.tsx")
clean_file("C:/Synco2-main/frontend/app/(coord)/projects/[id]/tree.tsx")
clean_file("C:/Synco2-main/frontend/app/(spec)/nuevo.tsx")
clean_file("C:/Synco2-main/frontend/app/(spec)/noticias.tsx")
