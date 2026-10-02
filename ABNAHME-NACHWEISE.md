# Lokale Abnahme-Nachweise

Stand: 2026-10-02. Host: Apple Silicon (arm64), macOS 14.6.1 (23G93). Dies ist kein Nachweis auf einem frischen Mac.

## Behobene Ursachen

- Ein `bundle`-Abschnitt enthält Sidecar und Agent-Runtime. Der Release startet den Sidecar neben dem App-Executable und nutzt Ressourcen im App-Bundle; persönliche Entwicklerpfade und `npx` entfallen.
- Node und alle installierten Produktionsabhängigkeiten werden beim Build mitgeliefert. Apple Silicon wird ausdrücklich geprüft. Tauri-JavaScript-API wurde an Rust 2.11 angeglichen; npm- und Bun-Lockfile sind aktualisiert.
- Export-Tool lädt Dateien auf den Mac, bevor die Sandbox gelöscht wird. Ergebnislinks öffnen ausschließlich Dateien innerhalb `Downloads/Cue` in Finder; absolute Fremdpfade und Verzeichnistraversal werden abgewiesen.
- Preview-Sandboxes bekommen einen serverseitigen Kill-Timeout von zehn Minuten. Er wird bei Task-Ende erneuert; andere Sandboxes werden sofort zerstört. Ablaufzeit wird im Ergebnis angezeigt.
- Exit-Codes, Tool-Ergebnis und Fortschritts-Event stimmen überein. Verzeichnisnamen werden als Argument übergeben, nicht als Shell-Code.
- Nichtleerer Modelltext reicht nicht mehr für Erfolg: erfolgreiche Tool-Ausführung ist erforderlich; unbehandelte Tool-Fehler, Schleifen und das Schrittlimit führen zu Fehlerstatus. Nur eine erfolgreiche Wiederholung desselben Aufrufs behebt dessen Fehler. Das ist eine technische Evidenzprüfung, keine Garantie für vollständige oder sachlich richtige Modellantworten.
- Modellaufrufe haben feste Abbruchfristen. Unerwartete Sidecar-Abbrüche werden als Fehler an die Oberfläche gemeldet, statt die UI still auf den Ausgangszustand zurückzusetzen.
- Browser-Seiten gelten ausdrücklich als nicht vertrauenswürdige Daten. Seitenanweisungen werden ignoriert; der Alpha-Browser führt keine Käufe, Formulare, Löschungen oder Kontoänderungen aus.
- Start, Schritte und Ende tragen Task-IDs. Jeder Task sendet sein Abschluss-Event unmittelbar nach eigenem Abschluss, unabhängig von anderen Tasks.
- App-Name und Menütexte heißen Cue. Bestehende App-ID bleibt erhalten, um Berechtigungen und gespeicherte Daten nicht durch eine Identitätsänderung zu verlieren.

## Reproduzierbare lokale Checks

Vom Repository-Root:

```sh
node --import tsx scripts/check-sandbox.ts
./node_modules/.bin/tsc --noEmit --module nodenext --moduleResolution nodenext --target es2022 --skipLibCheck orchestrator.ts sandbox-tools.ts browser-tools.ts
cd island-tauri
bun run build
cd src-tauri
cargo check --offline
```

Ergebnis: Sandbox-Checks, TypeScript und Frontend-Build erfolgreich. Rust-Check erfolgreich. Der Frontend-Build meldet bestehende Vite-Warnungen zu `use client` und zum zukünftigen Config-Loader.

Der Check verwendet lokale SDK-Doubles und prüft Browser-Leseergebnis und Fortschritts-Event sowie Exit-Code 0 und 1, fehlgeschlagene Installation, passende Fortschritts-Events, literal übergebene Verzeichnispfade, fehlende Ausführungsevidenz, erfolgreiche Wiederholung, exportierte Dateiinhalte und den Preview-Timeout. Er beweist keine Erreichbarkeit der Solari-Cloud.

Zusätzlicher Check nach dem App-Build:

```sh
node scripts/check-packaged-agent.mjs
```

Der Agent-Runtime wurde nach `/private/tmp` kopiert und von dort mit bereinigtem `PATH=/usr/bin:/bin` ohne Repository oder externe `node_modules` gestartet. Ergebnis: reguläre Nutzungsmeldung, Exit-Code 1, keine Import-/Runtime-Fehler. Node stammt aus der mitgelieferten Runtime.

## App-Build

```sh
cd island-tauri
bun run tauri build --bundles app --no-sign
```

Ergebnis: `src-tauri/target/release/bundle/macos/Cue.app` erfolgreich erzeugt. Im Bundle liegen `Contents/MacOS/island-agent` und `Contents/Resources/agent-runtime` mit Node, Orchestrator und Produktionsabhängigkeiten. Der Build ist etwa 151 MB groß; die Node-Runtime ist bewusst enthalten, damit kein externer Node-Install benötigt wird.

## Noch nicht abgenommen

- Installation und Onboarding auf einem zweiten, frischen Apple-Silicon-Mac.
- Echte Provider-Demos im installierten App-Build; genaue Prompts und erwartete Ergebnisse stehen in der README.
- Preview in einem zweiten Browser vor und nach serverseitigem Ablauf testen; exportierte Cloud-Datei in Finder öffnen.
- Zwei parallele echte Agent-Aufgaben und abgebrochene Aufgabe kontrollieren.
- Signierung, Notarisierung, Gatekeeper und Intel-Macs. Der lokale Build ist ausdrücklich unsigniert.

Die zugehörigen Checklist-Punkte bleiben bis zu diesen Nachweisen offen.

## Echte Cloud-Checks (vor dem letzten Release-Refactor)

Mit dem gebündelten Node/Agent-Runtime, isoliertem HOME und vorhandenen Provider-Keys:

- Browser / example.com: bestanden, ca. 35 Sekunden.
- Zwei parallele Browser-/Sandbox-Tasks: bestanden, ca. 41 Sekunden. CSV exportiert und alle 20 Primzahlen von 2 bis 71 geprüft; Start und Ende tragen passende Task-IDs.
- Shell-Exit-Code 7: bestanden, ca. 18 Sekunden; Task und Tool-Event meldeten Fehler.
- Preview: nicht bestanden. Ein Shell-Hintergrundprozess hielt den Ausgabestream offen; anschließend implementiert: nativer SDK-Prozessstart und Port-Bereitschaftsprüfung. Der Wiederholungsversuch wurde vom Provider-Concurrency-Limit blockiert. Erfolgreiche Preview-Erreichbarkeit und Ablauf bleiben offen.
- App-Kopie außerhalb des Repo ließ sich auf diesem Mac starten; Accessibility-Inspektion schlug fehl. Sichtbare doppelte Menübar-Instanzen wurden vom Nutzer bestätigt und die Testkopien anschließend geschlossen. Daraus folgte ein Instanz-Lock für den Release. Kein frischer Mac wurde getestet.

Logs der lokalen Ausführung: `/private/tmp/cue-cloud-acceptance/`. Diese temporären Dateien sind kein dauerhaftes Release-Artefakt. Der neueste Release-Refactor wurde nicht erneut mit Cloud-Aufrufen getestet.
