
# RAG

1. Extract PDF pages, DOCX paragraphs and DOCX table rows, plain-text blocks,
   CSV rows or XLSX sheet rows. Tesseract recognizes PDF pages that contain
   scanned images and lack a text layer. Recognized passages keep their PDF
   page number and an OCR marker.
2. Split long sections with the embedding tokenizer. Defaults are 800 tokens
   per retrieval chunk with 150 overlap, without crossing location boundaries.
   For E5, long chunks are embedded in smaller windows then averaged and
   normalized. Model dimensions are checked at startup of the encoder.
3. Prefix passages with `passage:` and queries with `query:`. Keep 384
   dimensions with the default multilingual E5-small model. PostgreSQL
   compares vectors by cosine distance and maintains a cosine HNSW index.
4. Scope every query to the current account and the chat's selected ready
   documents before applying the relevance threshold and Top K.
5. Send bounded excerpts and limited conversation history to the configured
   LLM. Document text is marked as untrusted, and the provider has no tools.
6. Accept citations only for numbered in-scope chunks returned by retrieval.
   If a single selected excerpt strongly overlaps an otherwise uncited
   answer, the server can attach that excerpt. When a source cannot be
   established, the answer abstains. Source buttons open authenticated
   previews using the actual chunk and document IDs.

Re-index documents when the embedding model changes. A 384-dimensional
model is required by the schema. The default shortlist is six chunks and the
default cosine threshold is 0.70. The retrieval path is semantic vector
search. Hybrid lexical ranking is a future improvement. See the
[multilingual E5 model card](https://huggingface.co/intfloat/multilingual-e5-small).
