# Adding OCR languages

Trigon reads scanned PDFs and images (screenshots, photos of documents) with
[Tesseract](https://github.com/tesseract-ocr/tesseract) OCR, so their text shows up in search.
**English and Greek are built in.** Every other language is one file that you put in a folder. You don't
need to rebuild or update anything.

## 1. Download the language file

Language files are named `<code>.traineddata`. Use the **fast** models. They are small (1–5 MB) and
quick, which suits a NAS:

```
https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/<code>.traineddata
```

| Language | Code | | Language | Code |
| -------- | ---- | - | -------- | ---- |
| German | `deu` | | Dutch | `nld` |
| French | `fra` | | Polish | `pol` |
| Italian | `ita` | | Romanian | `ron` |
| Spanish | `spa` | | Bulgarian | `bul` |
| Portuguese | `por` | | Russian | `rus` |
| Turkish | `tur` | | Ukrainian | `ukr` |
| Arabic | `ara` | | Serbian (Cyrillic) | `srp` |

All languages are listed in the [tessdata_fast repository](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0).
For example, German is
[`deu.traineddata`](https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/deu.traineddata).

> The larger `tessdata_best` models also work. They are a little more accurate, but 3–5× bigger and
> slower. For a NAS, the fast ones are the better choice.

## 2. Put it in `data/tessdata`

The folder sits next to Trigon's `docker-compose.yml`, beside `data/storage` and `data/backups`:

```
trigon/
├── docker-compose.yml
└── data/
    ├── storage/
    ├── backups/
    └── tessdata/          ← here
        └── deu.traineddata
```

- **Synology / Xpenology:** open File Station → `docker` → `trigon` → `data`, create the `tessdata`
  folder if it isn't there, and upload the file.
- **Over SSH:**

  ```bash
  cd /volume1/docker/trigon
  mkdir -p data/tessdata
  wget -P data/tessdata https://github.com/tesseract-ocr/tessdata_fast/raw/4.1.0/deu.traineddata
  ```

Trigon only reads this folder, so it needs no special permissions.

> **Upgrading from an older Trigon?** Your `docker-compose.yml` needs this line under `api` → `volumes`
> (it's in the current file in the repository). Run `docker compose up -d` once after adding it:
>
> ```yaml
>       - ./data/tessdata:/data/tessdata:ro
> ```

## 3. Turn it on

1. In Trigon, open **Settings → Search**. The new language appears under *Languages* with an **Added** badge.
2. Tick it and click **Save**.
3. Click **Read PDFs and images again**, so files that were already uploaded are read with the new language.

## Tips

- **The first ticked language is the main one.** Tesseract leans on it when a word could be read either
  way, so list the language most of your scans are in first. The default is Greek, then English. With
  English first, Greek words in mixed documents were sometimes read as Latin letters
  (`διακομιστή` → `SiakouloTh`).
- **Only tick the languages your documents use.** Tesseract tries every ticked language on every page,
  so each one makes OCR slower and can lower accuracy.
- **Pages per file** (default 50) limits how many scanned pages of one PDF are OCR'd. Text-based PDFs
  are not affected: all their text is always indexed.
- OCR works best on scans and screenshots. Photos taken at an angle or in poor light give weaker results.
  Diagrams with little text stay hard to find by their content.
- A file you put in `data/tessdata` with the same name as a built-in one (for example a
  `tessdata_best` `eng.traineddata`) replaces the built-in one.
- To remove a language, untick it in Settings and delete the file.

## Without Docker

When you run Trigon from source (`npm run dev`), OCR and PDF text need `tesseract` and `pdftotext`
(poppler) on your `PATH`. Point Trigon at your language folders with `TESSDATA_BUILTIN_DIR` and
`TESSDATA_DIR`. Without these tools, Office and text files are still indexed. PDFs are skipped, and
**Settings → Search** says that OCR isn't available.
