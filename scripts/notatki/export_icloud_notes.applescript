-- export_icloud_notes.applescript
-- Eksportuje notatki z Notes.app (konta iCloud) do plików HTML + manifest.
-- Zero zależności zewnętrznych — tylko macOS + Notes.app.
--
-- Wywołanie:
--   osascript export_icloud_notes.applescript <outDir> <lookbackDays> <accountFilter>
--     outDir        — istniejący katalog POSIX na pliki wyjściowe
--     lookbackDays  — 0 = wszystkie notatki, N = tylko zmodyfikowane w ostatnich N dni
--     accountFilter — "" = wszystkie konta, inaczej dokładna nazwa konta (np. "iCloud")
--
-- Produkuje w outDir:
--   html/<seq>-<id-hint>.html   — pełna notatka jako samodzielny HTML
--   manifest.json               — metadane dla Claude (czytelne)
--   manifest.tsv                — te same dane dla sync.sh (separator 0x1F)
--
-- Notatki zablokowane hasłem są pomijane (status "zablokowana") — Notes.app
-- nie udostępnia ich treści przez AppleScript i to jest poprawne zachowanie.

property SEP : (ASCII character 31) -- 0x1F, separator pól w TSV

on run argv
	if (count of argv) < 1 then error "Brak argumentu outDir"
	set outDir to item 1 of argv
	if outDir does not end with "/" then set outDir to outDir & "/"

	set lookbackDays to 0
	if (count of argv) ≥ 2 then
		try
			set lookbackDays to (item 2 of argv) as integer
		end try
	end if

	set accountFilter to ""
	if (count of argv) ≥ 3 then set accountFilter to item 3 of argv

	set htmlDir to outDir & "html/"
	do shell script "/bin/mkdir -p " & quoted form of htmlDir

	set sinceDate to missing value
	if lookbackDays > 0 then set sinceDate to (current date) - (lookbackDays * days)

	set jsonRows to {}
	set tsvRows to {}
	set seq to 0
	set skippedLocked to 0

	tell application "Notes"
		repeat with acc in accounts
			set accName to ""
			try
				set accName to (name of acc) as text
			end try

			if accountFilter is "" or accountFilter is accName then
				set theNotes to {}
				try
					if sinceDate is missing value then
						set theNotes to (every note of acc)
					else
						set theNotes to (every note of acc whose modification date > sinceDate)
					end if
				on error errMsg
					-- konto niedostępne (np. brak synchronizacji) — pomiń, nie przerywaj
					set theNotes to {}
				end try

				repeat with n in theNotes
					set seq to seq + 1
					set seqTxt to my padN(seq, 4)

					set noteId to ""
					set noteTitle to "(bez tytułu)"
					set folderName to ""
					set createdTxt to ""
					set modifiedTxt to ""
					set noteBody to ""
					set isLocked to false

					try
						set noteId to (id of n) as text
					end try
					try
						set noteTitle to (name of n) as text
					end try
					try
						set folderName to (name of container of n) as text
					end try
					try
						set createdTxt to my stampOf(creation date of n)
					end try
					try
						set modifiedTxt to my stampOf(modification date of n)
					end try
					try
						if (password protected of n) then set isLocked to true
					end try

					if isLocked then
						set skippedLocked to skippedLocked + 1
					else
						try
							set noteBody to (body of n) as text
						on error
							set noteBody to ""
						end try

						if noteId is "" then set noteId to "brak-id-" & seqTxt
						set safeTitle to my oneLine(noteTitle)
						if safeTitle is "" then set safeTitle to "(bez tytułu)"

						set htmlName to seqTxt & ".html"
						set htmlPath to htmlDir & htmlName

						set doc to my buildHtml(safeTitle, accName, folderName, createdTxt, modifiedTxt, noteBody)
						my writeUTF8(htmlPath, doc)

						set znakow to (count of characters of noteBody)

						set end of jsonRows to "    {" & ¬
							"\"seq\": \"" & seqTxt & "\", " & ¬
							"\"id\": \"" & my jsonEsc(noteId) & "\", " & ¬
							"\"tytul\": \"" & my jsonEsc(safeTitle) & "\", " & ¬
							"\"konto\": \"" & my jsonEsc(accName) & "\", " & ¬
							"\"folder_notes\": \"" & my jsonEsc(folderName) & "\", " & ¬
							"\"utworzona\": \"" & createdTxt & "\", " & ¬
							"\"zmodyfikowana\": \"" & modifiedTxt & "\", " & ¬
							"\"html\": \"html/" & htmlName & "\", " & ¬
							"\"znakow\": " & (znakow as text) & "}"

						set end of tsvRows to noteId & SEP & (my dayOf(modifiedTxt)) & SEP & safeTitle & SEP & ("html/" & htmlName) & SEP & accName & SEP & folderName
					end if
				end repeat
			end if
		end repeat
	end tell

	set nowStamp to my stampOf(current date)
	set jsonText to "{" & linefeed & ¬
		"  \"wygenerowano\": \"" & nowStamp & "\"," & linefeed & ¬
		"  \"lookback_dni\": " & (lookbackDays as text) & "," & linefeed & ¬
		"  \"konto_filtr\": \"" & my jsonEsc(accountFilter) & "\"," & linefeed & ¬
		"  \"pominieto_zablokowanych\": " & (skippedLocked as text) & "," & linefeed & ¬
		"  \"liczba\": " & ((count of jsonRows) as text) & "," & linefeed & ¬
		"  \"notatki\": [" & linefeed & my joinList(jsonRows, "," & linefeed) & linefeed & "  ]" & linefeed & "}" & linefeed

	my writeUTF8(outDir & "manifest.json", jsonText)
	my writeUTF8(outDir & "manifest.tsv", my joinList(tsvRows, linefeed) & linefeed)

	-- jedna linia na stdout dla sync.sh
	return "OK" & SEP & ((count of tsvRows) as text) & SEP & (skippedLocked as text)
end run

-- ---------- handlery pomocnicze ----------

on buildHtml(theTitle, accName, folderName, createdTxt, modifiedTxt, bodyHtml)
	set metaLine to my escHtml(accName)
	if folderName is not "" then set metaLine to metaLine & " › " & my escHtml(folderName)
	set metaLine to metaLine & " · utworzona " & createdTxt & " · zmodyfikowana " & modifiedTxt

	return "<!doctype html>
<html lang=\"pl\"><head><meta charset=\"utf-8\">
<title>" & my escHtml(theTitle) & "</title>
<style>
body { font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 12pt; line-height: 1.45; color: #111; }
h1.nb-title { font-size: 19pt; margin: 0 0 4pt 0; }
p.nb-meta { font-size: 8.5pt; color: #666; margin: 0 0 14pt 0; border-bottom: 1px solid #ccc; padding-bottom: 8pt; }
h1, h2, h3 { line-height: 1.25; }
table { border-collapse: collapse; }
td, th { border: 1px solid #bbb; padding: 3pt 6pt; }
img { max-width: 460px; }
ul, ol { margin: 6pt 0 6pt 18pt; }
</style></head><body>
<h1 class=\"nb-title\">" & my escHtml(theTitle) & "</h1>
<p class=\"nb-meta\">" & metaLine & "</p>
" & bodyHtml & "
</body></html>"
end buildHtml

on writeUTF8(thePath, theText)
	set fh to missing value
	try
		set fh to open for access (POSIX file thePath) with write permission
		set eof of fh to 0
		write theText to fh as «class utf8»
		close access fh
	on error errMsg
		if fh is not missing value then
			try
				close access fh
			end try
		end if
		error "Nie udało się zapisać " & thePath & ": " & errMsg
	end try
end writeUTF8

on replaceText(subj, findT, replT)
	set oldDelims to AppleScript's text item delimiters
	set AppleScript's text item delimiters to findT
	set parts to text items of subj
	set AppleScript's text item delimiters to replT
	set outT to parts as text
	set AppleScript's text item delimiters to oldDelims
	return outT
end replaceText

on joinList(theList, glue)
	set oldDelims to AppleScript's text item delimiters
	set AppleScript's text item delimiters to glue
	set outT to theList as text
	set AppleScript's text item delimiters to oldDelims
	return outT
end joinList

on escHtml(t)
	set t to my replaceText(t, "&", "&amp;")
	set t to my replaceText(t, "<", "&lt;")
	set t to my replaceText(t, ">", "&gt;")
	return t
end escHtml

on jsonEsc(t)
	set t to my replaceText(t, "\\", "\\\\")
	set t to my replaceText(t, "\"", "\\\"")
	set t to my replaceText(t, tab, " ")
	set t to my replaceText(t, return, " ")
	set t to my replaceText(t, linefeed, " ")
	set t to my replaceText(t, SEP, " ")
	return t
end jsonEsc

on oneLine(t)
	set t to my replaceText(t, return, " ")
	set t to my replaceText(t, linefeed, " ")
	set t to my replaceText(t, tab, " ")
	set t to my replaceText(t, SEP, " ")
	return t
end oneLine

on padN(n, width)
	set s to n as text
	repeat while (count of characters of s) < width
		set s to "0" & s
	end repeat
	return s
end padN

-- "2026-08-11 14:33" — niezależne od ustawień regionalnych
on stampOf(d)
	set y to (year of d) as integer
	set m to (month of d) as integer
	set dd to (day of d) as integer
	set hh to (hours of d) as integer
	set mi to (minutes of d) as integer
	return (my padN(y, 4)) & "-" & (my padN(m, 2)) & "-" & (my padN(dd, 2)) & " " & (my padN(hh, 2)) & ":" & (my padN(mi, 2))
end stampOf

on dayOf(stampTxt)
	if (count of characters of stampTxt) ≥ 10 then return text 1 thru 10 of stampTxt
	return "0000-00-00"
end dayOf
