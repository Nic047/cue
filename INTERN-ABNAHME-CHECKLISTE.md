# Abnahme-Checkliste: Solari-Projekt

Lokaler Implementierungs- und Prüfstand: [ABNAHME-NACHWEISE.md](ABNAHME-NACHWEISE.md). Frisch-Mac- und Cloud-Abnahme sind noch offen.

**Ziel:** Die App lässt sich auf einem frischen Mac starten, erledigt Browser- und Sandbox-Aufgaben zuverlässig und liefert ein überprüfbares Ergebnis. Hake einen Punkt erst ab, wenn du den Nachweis dokumentiert hast.

## Die vier wichtigsten Aufgaben

### 1. App auf einem fremden Mac starten können

- [x] Entferne feste Entwicklerpfade aus Sidecar und Rust-Bridge. Die App darf weder `~/Downloads/files` noch ein persönliches `npx`-Verzeichnis voraussetzen.
- [x] Führe die doppelten `bundle`-Einträge in `tauri.conf.json` zusammen und stelle sicher, dass der Build den Sidecar mitliefert.
- [ ] Erzeuge und installiere den App-Build auf einem unterstützten Mac, auf dem das Repository und `node_modules` nicht vorhanden sind.
- [ ] Starte die installierte App und erreiche das Onboarding. Dokumentiere Mac-Modell, macOS-Version und genaue Build- und Installationsschritte.
- [x] Ersetze die sichtbaren Tauri-Platzhalter und schreibe eine kurze README, mit der eine andere Person die App starten und die benötigten Keys einrichten kann.

**Fertig, wenn:** die installierte App ohne Quellcode-Checkout und ohne persönliche Pfade startet.

### 2. Ergebnisse aus der Sandbox tatsächlich nutzbar machen

- [ ] Sorge dafür, dass generierte Dateien vor dem Löschen der Sandbox an den Nutzer übergeben werden können.
- [ ] Halte eine erzeugte Preview nach Anzeige der Antwort für die versprochene Dauer erreichbar. Die Sandbox darf nicht sofort beendet werden, solange die App ihre Preview als nutzbar anbietet.
- [ ] Lege fest und dokumentiere, wann Sandbox und Preview beendet werden. Räume sie danach zuverlässig auf, damit keine unnötigen Kosten entstehen.
- [ ] Öffne die Preview nach Ende der Agent-Aufgabe in einem zweiten Browser und prüfe eine erzeugte Datei anhand eines konkreten Beispiels.

**Fertig, wenn:** Dateien abrufbar und versprochene Previews nach Abschluss erreichbar sind, und ihre spätere Bereinigung nachvollziehbar funktioniert.

### 3. Erfolge und Fehler korrekt anzeigen

- [x] Gib Befehle mit Exit-Code ungleich null als Fehler zurück. `run_command` und `run_shell` melden derzeit auch bei einem fehlgeschlagenen Befehl Erfolg.
- [x] Stelle sicher, dass Tool-Ergebnis, Fortschritts-Event und UI denselben Erfolg oder Fehler anzeigen. Insbesondere darf ein fehlgeschlagener Paketinstallationsversuch kein Erfolgs-Event erzeugen.
- [x] Markiere eine Aufgabe nicht allein deshalb als erfolgreich, weil das Modell irgendeinen Text zurückgegeben hat.
- [ ] Verbinde Start-, Fortschritts- und Abschlussmeldungen über eine stabile Task-ID. Zeige jeden Task direkt nach seinem Abschluss als beendet an.
- [ ] Prüfe einen erfolgreichen Befehl, einen fehlschlagenden Befehl, einen Agent-Fehler und zwei parallel laufende Aufgaben.

**Fertig, wenn:** Nutzer für jeden geprüften Lauf erkennen kann, was tatsächlich erfolgreich war und was fehlgeschlagen ist.

### 4. Beide Hauptabläufe reproduzierbar vorführen

- [ ] Führe eine dokumentierte Browser-Aufgabe mit überprüfbarer Antwort aus.
- [ ] Führe eine dokumentierte Sandbox-Aufgabe aus und prüfe die Datei oder Preview, die dabei entsteht.
- [ ] Prüfe, dass beide Beispiele im fertigen App-Build laufen, nicht nur im lokalen Dev-Modus.
- [ ] Dokumentiere die nötigen Provider-Keys und Berechtigungen, die ausgeführten Schritte, das erwartete Ergebnis und bekannte Einschränkungen. Verwende keine echten Kundendaten.
- [ ] Halte Build- und Testergebnisse fest. Berichte fehlgeschlagene oder nicht geprüfte Punkte offen und gib bei Blockaden Reproduktionsschritte an.

**Fertig, wenn:** eine zweite Person beide Beispiele anhand deiner Anleitung nachvollziehen kann.

## Abgabe

- [ ] Änderungen und wichtigste Entscheidungen kurz auflisten.
- [ ] Nachweise zu allen vier Aufgaben beilegen; Screenshots oder eine kurze Aufzeichnung des installierten App-Builds ergänzen.
- [ ] Offene Fehler und bekannte Einschränkungen nennen.

## Abnahmekriterium

Wir nehmen das Projekt ab, wenn der installierte Build auf einem frischen unterstützten Mac startet, Browser- und Sandbox-Aufgaben ihre Ergebnisse zuverlässig liefern und jeder der vier Punkte durch einen nachvollziehbaren Nachweis belegt ist.
