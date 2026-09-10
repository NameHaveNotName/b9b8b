from __future__ import annotations

import sys
from pathlib import Path

import win32com.client  # type: ignore


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: render_docx_with_word.py input.docx output.pdf")

    input_path = Path(sys.argv[1]).resolve()
    output_path = Path(sys.argv[2]).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    word = win32com.client.DispatchEx("Word.Application")
    word.Visible = False
    word.DisplayAlerts = 0
    try:
        doc = word.Documents.Open(str(input_path))
        try:
            doc.ExportAsFixedFormat(str(output_path), 17)
        finally:
            doc.Close(False)
    finally:
        word.Quit()

    print(output_path)


if __name__ == "__main__":
    main()
