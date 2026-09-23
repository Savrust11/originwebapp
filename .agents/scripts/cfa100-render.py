"""Private source audit only: fetch approved source and render every PDF page."""
import hashlib
import json
from pathlib import Path
from urllib.request import urlopen

import fitz

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "evidence-work/cfa100-06/source"
INPUT = ROOT / "attached_assets/Pasted--format-We-v1-DB-source-candidate-source-id-CFA100-1789_1789881203956.txt"


def main():
    supplied = json.loads(INPUT.read_text())
    OUT.mkdir(parents=True, exist_ok=True)
    data = urlopen(supplied["source"]["pdf_url"], timeout=120).read()
    actual = hashlib.sha256(data).hexdigest()
    if actual != supplied["source"]["sha256"]:
        (OUT / "unmatched-download.pdf").write_bytes(data)
        raise ValueError(f"Source version mismatch: {actual}; approved facts unchanged")
    (OUT / "original.pdf").write_bytes(data)
    doc = fitz.open(stream=data, filetype="pdf")
    assert len(doc) == 10
    pages = []
    for i, page in enumerate(doc, 1):
        image = OUT / f"page-{i:02}.png"
        page.get_pixmap(matrix=fitz.Matrix(2, 2)).save(image)
        pages.append({"pdf_page": i, "image": image.name,
                      "extracted_text_characters": len(page.get_text()),
                      "sha256": hashlib.sha256(image.read_bytes()).hexdigest()})
        if i in (3, 4, 5, 6, 7, 8):
            for label, region in (
                ("upper", fitz.Rect(0, 0, page.rect.width, page.rect.height * .51)),
                ("lower", fitz.Rect(0, page.rect.height * .50, page.rect.width, page.rect.height * .84)),
            ):
                page.get_pixmap(matrix=fitz.Matrix(3, 3), clip=region).save(
                    OUT / f"page-{i:02}-{label}.png")
    (OUT / "render-manifest.json").write_text(json.dumps({
        "private_audit_only": True, "ui_ingestion_allowed": False,
        "source_sha256": actual, "metadata": doc.metadata, "pages": pages
    }, ensure_ascii=False, indent=2) + "\n")
    print(f"SHA256 {actual}: 10 pages rendered for private visual audit")


if __name__ == "__main__":
    main()