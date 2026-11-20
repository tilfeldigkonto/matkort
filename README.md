# Matkort

Næringskalkulator som kjører i nettleseren. Produkter og retter lagres lokalt i IndexedDB. Etiketter leses med Tesseract.js på telefonen.

Krever Node.js 20.19 eller nyere.

```bash
npm install
npm run dev
```

Åpne adressen Vite viser, vanligvis `http://localhost:5173`. Serveren lytter bare på denne maskinen.

```bash
npm run build
npm run preview
```

Ferdig bygg ligger i `dist/`.

## iPhone

Appen installeres fra Safari, ikke App Store.

1. Opprett et offentlig GitHub-repo, for eksempel `matkort`, på branchen `main`.
2. Under **Settings → Pages**, velg **GitHub Actions**.
3. Push. `.github/workflows/deploy.yml` publiserer ved push til `main`.
4. Åpne `https://BRUKERNAVN.github.io/matkort/` i Safari.
5. **Del → Legg til på Hjem-skjermen**.

Bytt ut brukernavn og reponavn. Workflowen setter base-path fra reponavnet. På GitHub Free må repoet være offentlig, og nettstedet er åpent for alle med adressen. Matdata ligger bare på telefonen.

Netlify eller Cloudflare Pages fungerer også. Last opp `dist`, eller bygg hos dem. For en undermappe, sett `VITE_BASE_PATH` til stien med avsluttende `/`.

## Data

Innhold synkroniseres ikke mellom PC og telefon. Flytt det via **Mer → Eksporter** og **Importer**. Sletting av nettsteddata i Safari kan tømme databasen.

OCR kan lese feil, særlig når etiketten har flere kolonner. Kontroller tallene før lagring. Første skanning laster worker og norsk språkmodell fra samme adresse som appen. Deretter kan skanning virke offline.

Verdier er per 100 g eller 100 ml. `3 dl` melk er 300 ml. Volum og vekt regnes bare om når produktet har tetthet (g/ml). `stk` krever mengde per stykk.
