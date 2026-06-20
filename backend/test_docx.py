from docx import Document
import sys
from pathlib import Path
from app.compressors.docx_compressor import compress_docx

doc = Document()
doc.add_heading('Test Document', 0)
doc.save('test.docx')

try:
    print("compressing...")
    compress_docx(Path('test.docx'), Path('.'), 'low')
    print("success")
except Exception as e:
    print(f"Error: {e}")
    import traceback
    traceback.print_exc()
