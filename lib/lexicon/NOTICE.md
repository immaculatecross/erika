# Lexicon assets — attribution & license (NOTICE)

This directory ships two **derived, reduced** license-clean assets:

- `morphit-lemmas.tsv.gz` — the canonical (lemma, POS) validator set (E-25).
- `frequency-lexicon.tsv.gz` — the frequency-ranked lemma inventory (E-26a).

Both derive from **CC BY-SA** sources and are redistributed under **CC BY-SA**
(share-alike). No **CC BY-NC** resource (Kelly's CEFR bands, itWaC, spaCy models)
is present in either asset or anywhere in the data path (D-19).

## morph-it (both assets)

`morphit-lemmas.tsv.gz` and the lemmatization behind `frequency-lexicon.tsv.gz`
are built from the **Morph-it!** free morphological resource for Italian:

> Marco Baroni and Eros Zanchetta. *Morph-it! A free corpus-based morphological
> resource for the Italian language.* University of Bologna / University of Trento.
> <https://docs.sslmit.unibo.it/doku.php?id=resources:morph-it>

## License

Morph-it! is distributed under the **Creative Commons
Attribution-ShareAlike 2.0** license (also available under the LGPL). This
attribution satisfies the **BY** term; the **SA** term is satisfied by
distributing this derived asset under the same license.

**The derived asset (`morphit-lemmas.tsv.gz`) is licensed CC BY-SA 2.0**, the same
license as the upstream data. It is not covered by the repository's own license.

## What the derivation does

The source is the raw Morph-it! table (`morph-it_048_utf8.txt`, ~505k rows,
tab-separated `form ⟶ lemma ⟶ features`). It is reduced by
`scripts/build-morphit-lemmas.ts` to the **distinct set of (lemma, POS) pairs**:

- morph-it feature tags are collapsed to this project's coarse POS scheme
  (`lib/lexicon/pos.ts`);
- punctuation, sentence, and symbol rows, and rows that map to no lexical POS, are
  dropped;
- malformed rows (not three tab fields) are skipped.

The result is ~38k `lemma\tPOS` lines, gzipped. No inflected forms, frequencies, or
morphological features are retained — only the canonical (lemma, POS) inventory the
lemma validator needs.

## Regenerating

The raw 19 MB source is **not** committed. To rebuild the asset:

```
git clone --depth 1 https://github.com/giodegas/morphit-lemmatizer
npx tsx scripts/build-morphit-lemmas.ts morphit-lemmatizer/master/morph-it_048_utf8.txt
```

## FrequencyWords (frequency-lexicon.tsv.gz only)

`frequency-lexicon.tsv.gz` additionally derives from the **FrequencyWords** Italian
frequency list — OpenSubtitles-2018 wordform counts:

> Hermit Dave. *FrequencyWords* — frequency word lists from the OpenSubtitles
> corpus. <https://github.com/hermitdave/FrequencyWords>

### License

FrequencyWords is distributed under **Creative Commons Attribution-ShareAlike 4.0**
(the OpenSubtitles frequency data it is built on is CC BY-SA). This attribution
satisfies **BY**; distributing the derived asset under CC BY-SA satisfies **SA**.

### What the derivation does

`scripts/build-lexicon.ts` reduces the raw `content/2018/it/it_full.txt` (~798k
`word count` lines) to a frequency-ranked lemma inventory:

- each wordform is lemmatized through the Morph-it! form→lemma+POS map above and
  its count summed up to `(lemma, POS)` (a count on an ambiguous form is split
  equally across its distinct readings);
- proper nouns, foreign intrusions, digit/punctuation tokens, single-symbol junk,
  and forms Morph-it! cannot lemmatize are dropped (a stoplist pass);
- every surviving `(lemma, POS)` is kept only if the E-25 validator `attestsLemma`
  accepts it — nothing fabricated, misspelled, or foreign enters;
- survivors above a stated aggregated-frequency floor are ranked dense & unique
  (1 = most frequent) and banded by rank.

The result is a `lemma\tPOS\tfreq_rank\tband` table (a `#`-prefixed header records
the source, cutoff, count, and POS breakdown), gzipped. **No raw wordforms,
counts, proper nouns, or CC BY-NC data are retained** — only the ranked, validated
lemma inventory the seed needs. The raw sources are **not** committed.

### Regenerating

```
git clone --depth 1 https://github.com/hermitdave/FrequencyWords
git clone --depth 1 https://github.com/giodegas/morphit-lemmatizer
npx tsx scripts/build-lexicon.ts \
  FrequencyWords/content/2018/it/it_full.txt \
  morphit-lemmatizer/master/morph-it_048_utf8.txt
```
