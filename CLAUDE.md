# CLAUDE.md — pamięć projektu

**InvoiceGuard** — SaaS (Next.js 15 + React 19 + TypeScript + Prisma + Postgres). Audyt faktur B2B / odzysk kosztów.

## Narzędzia Claude Code (autobiznes, autoodpowiedzi, autoc)

Te systemy **nie mieszkają już w tym repo**. Zostały wyniesione do osobnego
nadprojektu **friday** — meta-repo na wszystkie usprawnienia Claude Code i
narzędzia zrobione prywatnie, żeby nie mieszać automatyzacji z kodem produktu
i żeby dało się z nich korzystać w dowolnym projekcie.

Repo: `antonisetkowicz/x6` (docelowo do zmiany nazwy na `friday` w ustawieniach
GitHuba — obecnie wciąż widnieje pod starą nazwą `x6`, GitHub App użyta w tej
sesji nie ma uprawnień do tworzenia/renejmowania repozytoriów).

Żeby użyć `/autobiznes`, `/autoodpowiedzi`, `/autoc`, `/coldmail`, `/wyslij` —
otwórz sesję Claude Code w repo friday, nie tutaj.

---

## Stan prac (aktualne decyzje)

- **Wybrany produkt (human override na idea-3)**: **„Sekwencer"** — cold-email engine dla agencji/freelancerów B2B (generuje spersonalizowane sekwencje z listy firm + eksport do Instantly). Monetyzacja 149–499 zł/mc. Prace nad Sekwencerem (krok 3 `copy.json`, krok 4 landing) toczyły się w `run/` — katalog był gitignorowany, artefakty nie trafiły do repo i nie zostały przeniesione do friday. Wznów je uruchamiając `/autobiznes` od nowa w friday, jeśli temat jest wciąż aktualny.
