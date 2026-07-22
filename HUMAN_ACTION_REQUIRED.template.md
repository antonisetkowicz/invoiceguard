# HUMAN_ACTION_REQUIRED — szablon

> To jest SZABLON. Realny plik `HUMAN_ACTION_REQUIRED.md` powstaje w root repo
> DOPIERO gdy któryś subagent natrafi na akcję wymagającą człowieka.
> Każdy agent **dopisuje** własną sekcję (nie nadpisuje). Jeśli po całym runie
> `HUMAN_ACTION_REQUIRED.md` nie istnieje lub jest pusty — wszystko poszło
> automatycznie.

Format dopisywanej sekcji (agent stosuje dokładnie taki):

```markdown
## [<nazwa-agenta>] <run_id> — <ISO timestamp>
- **Co**: krótko czego potrzeba (np. zakup domeny, logowanie 2FA, zgoda na wysyłkę)
- **Dlaczego wymaga człowieka**: płatność kartą / 2FA / CAPTCHA / podpis / decyzja prawna
- **Dokładne kroki dla Ciebie**:
  1. ...
  2. ...
- **Blokuje**: co w pipeline jest wstrzymane do czasu wykonania (albo „nic — pipeline poszedł dalej z degradacją")
- **Artefakt/kontekst**: ścieżka do pliku w ./run/<run_id>/
```
