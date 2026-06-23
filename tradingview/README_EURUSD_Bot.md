# EURUSD Multi-Confluence Trading Bot

## Strategia

Bot oparty na **6 warstw konfluencji** (multi-confluence), co minimalizuje fałszywe sygnały:

### Wskaźniki użyte w strategii:

| Wskaźnik | Rola | Parametry |
|----------|------|-----------|
| **EMA 200** | Filtr trendu głównego | 200 okresów |
| **EMA 50** | Potwierdzenie trendu | 50 okresów |
| **EMA 8/21** | Sygnał wejścia (crossover) | 8 i 21 okresów |
| **RSI 14** | Filtr momentum | 30-70 strefa neutralna |
| **MACD 12/26/9** | Potwierdzenie kierunku | Histogram + linia sygnału |
| **ATR 14** | Dynamiczny SL/TP | 1.5x SL, 2.5x TP |

### Warunki wejścia LONG:
1. Cena > EMA 200 i EMA 50 > EMA 200 (trend wzrostowy)
2. EMA 8 przecina EMA 21 od dołu (crossover)
3. RSI między 30 a 70 (nie jest w ekstremalnych strefach)
4. MACD linia > linia sygnału i histogram > 0
5. Aktywna sesja London lub NY

### Warunki wejścia SHORT:
1. Cena < EMA 200 i EMA 50 < EMA 200 (trend spadkowy)
2. EMA 8 przecina EMA 21 od góry (crossunder)
3. RSI między 30 a 70
4. MACD linia < linia sygnału i histogram < 0
5. Aktywna sesja London lub NY

## Zarządzanie ryzykiem

- **Stop Loss**: 1.5x ATR od ceny wejścia
- **Take Profit**: 2.5x ATR od ceny wejścia (R:R = 1:1.67)
- **Trailing Stop**: 1.0x ATR (opcjonalny)
- **Break-Even**: SL przesuwa się na BE po 1.0x ATR w zysku
- **Wielkość pozycji**: 2% equity per trade
- **Max otwartych pozycji**: 3

## Dlaczego ta strategia jest profitable?

1. **Filtr trendu (EMA 200 + EMA 50)** - tradujemy TYLKO z trendem, nie przeciwko
2. **Multi-confluence** - 5+ warunków musi być spełnionych = mniej sygnałów, ale wyższa jakość
3. **Filtr sesji** - tradujemy tylko w London + NY (największa płynność na EURUSD)
4. **Risk:Reward 1:1.67** - wystarczy 40% win rate żeby być profitable
5. **ATR-based stops** - dynamiczne SL/TP dopasowują się do zmienności rynku
6. **Break-Even** - chroni kapitał po osiągnięciu 1 ATR zysku
7. **Trailing Stop** - pozwala zyskom rosnąć w silnych ruchach

## Instalacja na TradingView

1. Otwórz [TradingView](https://www.tradingview.com)
2. Otwórz chart EURUSD (zalecany timeframe: **1H** lub **4H**)
3. Kliknij "Pine Editor" na dole ekranu
4. Wklej zawartość pliku `EURUSD_MultiConfluence_Strategy.pine`
5. Kliknij "Add to chart"
6. Otwórz "Strategy Tester" aby zobaczyć wyniki backtestów

## Zalecane timeframe'y

| Timeframe | Opis |
|-----------|------|
| **1H** | Więcej sygnałów, mniejsze ruchy |
| **4H** | Optymalny balans sygnałów i jakości (zalecany) |
| **1D** | Mniej sygnałów, większe ruchy, wyższy win rate |

## Ustawianie alertów

Po dodaniu strategii do charta:
1. Kliknij prawym przyciskiem na chart
2. Wybierz "Add Alert"
3. Wybierz "EURUSD Multi-Confluence Bot" jako condition
4. Wybierz "Long Entry" lub "Short Entry"
5. Ustaw notyfikacje (email, push, webhook)

## Optymalizacja

Parametry można dostosować w ustawieniach strategii na TradingView:
- Dla większej agresywności: zmniejsz EMA fast/slow, zwiększ ATR TP multiplier
- Dla większego bezpieczeństwa: zwiększ EMA trend length, zmniejsz max trades
- Wyłącz filtr sesji jeśli chcesz tradować 24/5

## Disclaimer

Ta strategia jest narzędziem edukacyjnym. Wyniki historyczne nie gwarantują przyszłych zysków. Traduj na własne ryzyko. Zawsze testuj na koncie demo przed użyciem prawdziwych pieniędzy.
