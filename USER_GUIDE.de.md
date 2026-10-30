# Benutzerhandbuch

Beim ersten Start fragt LYTEX OS nach deinem Namen (für Zuordnungen und „Meine Arbeit“) und legt den
Ordner `LYTEX OS/` an (änderbar in den Plugin-Einstellungen).

Öffnen: Menüband-Symbol **Aktentasche** (Hauptansicht) bzw. **Stoppuhr** (Timer-Seitenleiste) oder
Befehlspalette → „LYTEX Operations OS: …“. Alle Befehle lassen sich unter Einstellungen → Tastenkürzel
mit eigenen Shortcuts belegen (z. B. _Timer pausieren/fortsetzen_, _Timer stoppen & speichern_,
_Timer für Ticket starten …_).

## Typischer Ablauf

1. **Kunde anlegen** (`+ Kunde`). Mögliche Dubletten (Name, E-Mail-Domain, USt-IdNr., Telefon) werden
   direkt im Formular angezeigt. Passwörter nie eintragen – nur Verweise auf den Passwort-Manager.
2. **Projekt anlegen** (Assistent in 3 Schritten): Grunddaten → Abrechnungsmodell (nach Aufwand,
   Festpreis, Retainer, intern) und Sätze → Budget (vertraglich) und interne Schätzung.
3. **Tickets anlegen** – optional aus Vorlage (Bugfix, Feature, Wartung, Support). Kanban per
   Drag & Drop oder Tastatur (Karte fokussieren, Alt+←/→ Status, Alt+↑/↓ Reihenfolge).
4. **Zeit erfassen**: ▶ am Ticket/Projekt, in der Timer-Seitenleiste oder per Befehl. Pause/Fortsetzen
   erzeugt Segmente. Projekt, Ticket, Notiz und „abrechenbar“ sind während der Laufzeit änderbar.
   Stoppen speichert genau einen Zeiteintrag. Sehr kurze Zeiten (< Mindestdauer) werden nachgefragt.
5. **Abrechnung**: Kunde wählen → Einträge prüfen → _Freigeben_ → optional Ausgaben, Festpreis,
   Retainer-Monate, Rabatt → Vorschau → _Abrechnungslauf erstellen_.
6. **CSV exportieren** (Ordner `04 Finance/Exports`) und die Rechnung im Buchhaltungssystem erstellen.
   Der Export ändert **keinen** Status.
7. **Rechnung bestätigen** mit der externen Rechnungsnummer → Einträge werden „abgerechnet“ und
   gesperrt. Später optional **Zahlung erfassen**.

## Tickets, Team und Einstellungen

- **Tickets** (Navigation direkt unter Dashboard) mit Filter-Reitern: _Meine Arbeit_ (alle offenen Tickets,
  die dir zugeordnet sind), Alle offenen, Bald fällig, Überfällig, Erledigt, Alle.
- **Zugeordnet**: mehrere Personen pro Ticket; weitere Namen direkt im Formular eintippen (werden in die
  Team-Liste übernommen). Team und „Das bin ich“ unter _Einstellungen_.
- **Schätzung** in Minuten oder Stunden wählbar.
- **Beschreibung & Notizen** im Ticket mit Markdown und Bildern (Button 🖼, Strg+V oder Datei hineinziehen;
  Bilder liegen im Ordner `Attachments` des Projekts).
- **Kanban**: Karten auch innerhalb einer Spalte nach oben/unten ziehen (oder Alt+↑/↓).
- **Automatisch archivieren**: Tickets, die seit 30 Tagen erledigt sind, werden beim Start und täglich
  archiviert (einstellbar in den Plugin-Einstellungen, 0 = nie). Archivierte Tickets lassen sich jederzeit
  wiederherstellen.
- **Löschen** mit Rückfrage (landet im Papierkorb). Datensätze mit Zeiten/Abrechnungen können nicht
  gelöscht werden – dann archivieren.
- **Einstellungen**: Akzentfarbe, Team, API-Schlüssel (sicher im Obsidian-Schlüsselbund).

## Timer-Wiederherstellung

Lief der Timer, als Obsidian abstürzte/beendet wurde, der Rechner neu startete oder im Ruhezustand war,
erscheint beim nächsten Start (bzw. beim Aufwachen) ein Dialog. Die Zeit seit dem letzten Lebenszeichen
wird **nicht** automatisch gezählt. Optionen: nicht zählen und stoppen / weiterlaufen, Arbeitsende
festlegen, bewusst als Arbeitszeit bestätigen, Sitzung verwerfen.

## Zeiteinträge korrigieren

- Offene/freigegebene Einträge: ✎ in der Zeiterfassung – jede Änderung wird mit Grund in der Historie
  gespeichert.
- Abgerechnete Einträge sind gesperrt. Korrektur über **±** (Korrekturbuchung): ein separater Eintrag
  mit positiver/negativer Dauer zum gleichen Satz, der im nächsten Lauf abgerechnet wird.
- Überschneidungen werden gewarnt (oder je nach Einstellung blockiert).

## Ansichten

Dashboard · Tickets (inkl. Meine Arbeit) · Kunden · Projekte (Übersicht, Tickets, Zeiten, Finanzen) · Tickets (Liste/
Kanban, Filter: offen, meine, bald fällig, überfällig, erledigt, alle) · Zeiterfassung (Wochenansicht,
CSV-Zeitnachweis) · Abrechnung · Angebote · Ausgaben · Wiederkehrend · Leistungen · Analysen · Datenprüfung · Einstellungen.
Globale Suche oben (↑/↓/Enter). Jede Entität lässt sich mit „Notiz öffnen“ als normale Markdown-Notiz
öffnen; im Datei-Kontextmenü gibt es „LYTEX OS: Öffnen“ und „Timer starten“.

## Wiederkehrende Aufgaben

Täglich, wöchentlich (Wochentage), monatlich (Tag; 31 = Monatsletzter) oder alle n Tage. Tickets werden
`Vorlauf` Tage im Voraus erzeugt; verpasste Termine (Obsidian war geschlossen) werden beim Start
nachgeholt. Jeder Termin erzeugt höchstens ein Ticket.

## Notizen direkt bearbeiten

Frontmatter darf in Obsidian bearbeitet werden. Ungültige Werte werden unter **Datenprüfung**
gemeldet, die Datei wird bis zur Korrektur ignoriert und nie automatisch überschrieben. Den Notiztext
(unterhalb des Frontmatters) verändert das Plugin nach dem Anlegen nicht mehr.
