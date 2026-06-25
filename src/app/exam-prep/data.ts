export interface Question {
  id: number;
  topic: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface Flashcard {
  id: number;
  topic: string;
  front: string;
  back: string;
}

export const TOPICS = [
  "Funkcjonalność i funkcje finansów",
  "Rynkowy system finansowy – instytucje",
  "Instytucje ubezpieczeniowe i fundusze",
  "Publiczny system finansowy",
  "Finanse a ryzyko",
] as const;

export type Topic = (typeof TOPICS)[number];

export const TOPIC_COLORS: Record<Topic, string> = {
  "Funkcjonalność i funkcje finansów": "bg-blue-500",
  "Rynkowy system finansowy – instytucje": "bg-emerald-500",
  "Instytucje ubezpieczeniowe i fundusze": "bg-purple-500",
  "Publiczny system finansowy": "bg-amber-500",
  "Finanse a ryzyko": "bg-rose-500",
};

export const questions: Question[] = [
  // TOPIC 1: Funkcjonalność i funkcje finansów
  {
    id: 1,
    topic: "Funkcjonalność i funkcje finansów",
    question: "Jakie trzy funkcje opisują współczesne finanse?",
    options: [
      "Alokacyjna, redystrybucyjna, stabilizacyjna",
      "Fiskalna, monetarna, kredytowa",
      "Produkcyjna, konsumpcyjna, inwestycyjna",
      "Oszczędnościowa, kredytowa, ubezpieczeniowa",
    ],
    correctIndex: 0,
    explanation:
      "Współczesne finanse opisują trzy funkcje: alokacyjna (rozmieszczenie zasobów), redystrybucyjna (wtórny podział dochodu) i stabilizacyjna (łagodzenie wahań koniunktury).",
  },
  {
    id: 2,
    topic: "Funkcjonalność i funkcje finansów",
    question:
      "Co oznacza funkcja redystrybucyjna finansów?",
    options: [
      "Tworzenie nowego pieniądza przez bank centralny",
      "Wtórny podział dochodu narodowego – przemieszczanie pieniądza między podmiotami z innych przyczyn niż wymiana dóbr",
      "Alokacja czynników wytwórczych na rynku",
      "Stabilizowanie tempa wzrostu gospodarczego",
    ],
    correctIndex: 1,
    explanation:
      "Redystrybucja to podział wtórny dochodu narodowego. Z finansowej perspektywy oznacza przemieszczanie się pieniądza między podmiotami z innych przyczyn niż wymiana dóbr. Jeden podmiot przekazuje część swojej siły nabywczej na rzecz innego.",
  },
  {
    id: 3,
    topic: "Funkcjonalność i funkcje finansów",
    question:
      "Jakie są trzy główne przesłanki (motywy) akumulacji oszczędności?",
    options: [
      "Konsumpcyjny, produkcyjny, handlowy",
      "Transakcyjny, ostrożnościowy, spekulacyjny",
      "Fiskalny, monetarny, kredytowy",
      "Krótkoterminowy, średnioterminowy, długoterminowy",
    ],
    correctIndex: 1,
    explanation:
      "Motywy akumulacji oszczędności (rezerw) to: transakcyjny (na bieżące potrzeby), ostrożnościowy (na wypadek nieprzewidzianych zdarzeń) i spekulacyjny (w oczekiwaniu na korzystne okazje inwestycyjne).",
  },
  {
    id: 4,
    topic: "Funkcjonalność i funkcje finansów",
    question:
      "Jakie są główne kryteria alokacji kapitału?",
    options: [
      "Czas, miejsce, podmiot",
      "Płynność, dochodowość, ryzyko, bezpieczeństwo",
      "Stopa procentowa, inflacja, kurs walutowy",
      "Popyt, podaż, cena",
    ],
    correctIndex: 1,
    explanation:
      "Główne kryteria alokacji kapitału to: płynność (możliwość szybkiej zamiany na gotówkę), dochodowość (oczekiwany zysk), ryzyko (możliwość straty) i bezpieczeństwo.",
  },
  {
    id: 5,
    topic: "Funkcjonalność i funkcje finansów",
    question:
      "Czym różni się bezpośrednia transformacja oszczędności w kapitał od pośredniej?",
    options: [
      "Bezpośrednia jest szybsza, pośrednia wolniejsza",
      "W bezpośredniej oszczędności trafiają wprost do przedsiębiorstw przez instrumenty finansowe; w pośredniej uczestniczą instytucje finansowe",
      "Bezpośrednia dotyczy państwa, pośrednia – gospodarstw domowych",
      "Nie ma między nimi różnicy",
    ],
    correctIndex: 1,
    explanation:
      "W transformacji bezpośredniej oszczędności trafiają wprost do przedsiębiorstw poprzez instrumenty finansowe (np. akcje, obligacje). W pośredniej uczestniczą instytucje finansowe (np. banki), które tworzą własne instrumenty finansowe i pośredniczą w tym procesie.",
  },
  {
    id: 6,
    topic: "Funkcjonalność i funkcje finansów",
    question:
      "W jaki sposób gospodarstwa domowe wykorzystują finanse?",
    options: [
      "Tylko do wymiany towar-pieniądz",
      "Do wymiany, zmiany struktury konsumpcji w czasie, zabezpieczenia ryzyka i podziału",
      "Wyłącznie do oszczędzania",
      "Tylko do inwestowania na giełdzie",
    ],
    correctIndex: 1,
    explanation:
      "Gospodarstwa domowe wykorzystują finanse do: wymiany (nabywanie dóbr), zmiany struktury konsumpcji w czasie (oszczędzanie aktywne i bierne, kredytowanie konsumpcji), zabezpieczenia ryzyka (ubezpieczenia) oraz podziału dochodu.",
  },
  {
    id: 7,
    topic: "Funkcjonalność i funkcje finansów",
    question:
      "Czym jest stopa procentowa?",
    options: [
      "Kwota odsetek wyrażona w złotych",
      "Iloraz procentu do kwoty udostępnionego pieniądza wyrażony w określonej jednostce czasu",
      "Procent inflacji",
      "Różnica między ceną kupna a ceną sprzedaży",
    ],
    correctIndex: 1,
    explanation:
      "Stopa procentowa to iloraz procentu (odsetek) do kwoty udostępnionego pieniądza wyrażony w określonej jednostce czasu (np. 10% p.a. = 10% w skali roku). Jest miarą relatywną ceny pieniądza na rynku.",
  },
  {
    id: 8,
    topic: "Funkcjonalność i funkcje finansów",
    question:
      "Jakie rodzaje stóp procentowych wyróżniamy?",
    options: [
      "Tylko nominalna i realna",
      "Nominalna, efektywna, realna, rzeczywista",
      "Stała i zmienna",
      "Krótkoterminowa i długoterminowa",
    ],
    correctIndex: 1,
    explanation:
      "Wyróżniamy: nominalną (zawarta w umowie), efektywną (uwzględnia kapitalizację), realną (efektywna skorygowana o inflację) i rzeczywistą (odzwierciedla też inne koszty, np. prowizję).",
  },
  {
    id: 9,
    topic: "Funkcjonalność i funkcje finansów",
    question:
      "Funkcja stabilizacyjna finansów w ujęciu makro polega na:",
    options: [
      "Tworzeniu nowych produktów finansowych",
      "Łagodzeniu wahań cyklu koniunkturalnego przez politykę fiskalną i monetarną państwa",
      "Oszczędzaniu przez gospodarstwa domowe",
      "Inwestowaniu w fundusze inwestycyjne",
    ],
    correctIndex: 1,
    explanation:
      "W ujęciu makro funkcja stabilizacyjna realizowana jest przez państwo za pomocą polityki fiskalnej (cel: stabilizacja tempa wzrostu gospodarczego) i polityki monetarnej (cel: stabilizacja wartości pieniądza). Warunkiem skuteczności jest popytowy charakter przyczyn wahań cyklu.",
  },
  {
    id: 10,
    topic: "Funkcjonalność i funkcje finansów",
    question:
      "Czym różnią się przedsiębiorstwa sfery realnej od przedsiębiorstw sfery finansowej?",
    options: [
      "Mają różne cele ekonomiczne",
      "Przedsiębiorstwa sfery finansowej uczyniły z procesów finansowych główny przedmiot swojej działalności, ale cele ekonomiczne są tożsame",
      "Przedsiębiorstwa sfery realnej nie korzystają z finansów",
      "Przedsiębiorstwa sfery finansowej nie potrzebują kapitału",
    ],
    correctIndex: 1,
    explanation:
      "Cele ekonomiczne (np. wzrost wartości, zysk) są tożsame dla obu grup. Różnica polega na tym, że przedsiębiorstwa sfery finansowej uczyniły z procesów finansowych główny przedmiot działalności oraz na skali wykorzystania kapitału finansowego.",
  },

  // TOPIC 2: Rynkowy system finansowy – instytucje
  {
    id: 11,
    topic: "Rynkowy system finansowy – instytucje",
    question:
      "Jakie elementy tworzą strukturę rynkowego systemu finansowego?",
    options: [
      "Banki, giełdy, ubezpieczalnie",
      "Instytucje, instrumenty, rynki, zasady",
      "Kredyty, depozyty, akcje",
      "Państwo, przedsiębiorstwa, gospodarstwa domowe",
    ],
    correctIndex: 1,
    explanation:
      "Struktura rynkowego systemu finansowego obejmuje cztery elementy: instytucje (monetarne i niemonetarne), instrumenty (tworzące siłę nabywczą, przenoszące siłę nabywczą, płatnicze), rynki (kapitałowy, pieniężny) i zasady (normy prawne, rekomendacje, normy zwyczajowe).",
  },
  {
    id: 12,
    topic: "Rynkowy system finansowy – instytucje",
    question:
      "Jakie są trzy funkcje banku centralnego?",
    options: [
      "Bank kredytowy, bank inwestycyjny, bank hipoteczny",
      "Bank emisyjny, bank państwa, bank banków",
      "Bank komercyjny, bank spółdzielczy, bank rozwoju",
      "Bank oszczędnościowy, bank depozytowy, bank rozliczeniowy",
    ],
    correctIndex: 1,
    explanation:
      "Bank centralny pełni trzy funkcje: bank emisyjny (emituje pieniądz gotówkowy, reguluje podaż pieniądza), bank państwa (realizuje politykę monetarną, prowadzi rachunki rządu) i bank banków (przechowuje rezerwy banków, jest źródłem rezerwy kredytowej).",
  },
  {
    id: 13,
    topic: "Rynkowy system finansowy – instytucje",
    question:
      "Jakie są podstawowe instrumenty polityki pieniężnej?",
    options: [
      "Podatki, dotacje, subwencje",
      "Stopa rezerwy obowiązkowej, stopy kredytów refinansowych, operacje otwartego rynku",
      "Akcje, obligacje, bony skarbowe",
      "Kredyty, depozyty, gwarancje",
    ],
    correctIndex: 1,
    explanation:
      "Podstawowe instrumenty polityki pieniężnej to: stopa rezerwy obowiązkowej, stopy kredytów refinansowych (lombardowego, redyskontowego) oraz operacje otwartego rynku.",
  },
  {
    id: 14,
    topic: "Rynkowy system finansowy – instytucje",
    question:
      "Czym są operacje pasywne (bierne) banku?",
    options: [
      "Udzielanie kredytów i pożyczek",
      "Pozyskiwanie środków finansowych od klientów banku (np. przyjmowanie depozytów, emisja bankowych papierów wartościowych)",
      "Realizacja zleceń płatniczych klientów",
      "Przechowywanie przedmiotów wartościowych",
    ],
    correctIndex: 1,
    explanation:
      "Operacje pasywne (bierne) polegają na pozyskiwaniu środków finansowych od klientów banku. Bank wykonuje takie czynności jak przyjmowanie depozytów czy emitowanie bankowych papierów wartościowych.",
  },
  {
    id: 15,
    topic: "Rynkowy system finansowy – instytucje",
    question:
      "Co składa się na oprocentowanie kredytów w banku komercyjnym?",
    options: [
      "Tylko marża bankowa",
      "Oprocentowanie depozytów + koszty działalności + koszty zabezpieczenia depozytów + koszt alternatywny rezerwy obowiązkowej + marża bankowa + premia za ryzyko + zysk",
      "Stopa referencyjna NBP",
      "Inflacja + 2%",
    ],
    correctIndex: 1,
    explanation:
      "Oprocentowanie kredytów obejmuje: oprocentowanie depozytów, koszty działalności banku, koszty zabezpieczenia depozytów, koszt alternatywny rezerwy obowiązkowej, marżę bankową, premię za ryzyko i zysk banku.",
  },
  {
    id: 16,
    topic: "Rynkowy system finansowy – instytucje",
    question:
      "Czym różni się system finansowy zorientowany na banki od zorientowanego na rynek finansowy?",
    options: [
      "Nie ma różnicy",
      "W systemie bankowym przedsiębiorstwa pozyskują środki głównie przez kredyty bankowe; w rynkowym – przez emisję instrumentów finansowych (akcji, obligacji)",
      "System bankowy nie ma banku centralnego",
      "System rynkowy nie wykorzystuje pieniądza",
    ],
    correctIndex: 1,
    explanation:
      "W systemie zorientowanym na banki źródłem zasilania podmiotów deficytowych są przede wszystkim banki (kredyty z oszczędności GD). W systemie zorientowanym na rynek finansowy podmioty pozyskują środki przez emisję instrumentów finansowych (np. akcji, obligacji).",
  },
  {
    id: 17,
    topic: "Rynkowy system finansowy – instytucje",
    question:
      "Co to jest polecenie przelewu?",
    options: [
      "Wypłata gotówki z bankomatu",
      "Dyspozycja dłużnika udzielona bankowi obciążenia jego rachunku określoną kwotą i uznania tą kwotą rachunku wierzyciela",
      "Wpłata gotówki na rachunek",
      "Emisja czeku",
    ],
    correctIndex: 1,
    explanation:
      "Polecenie przelewu to udzielona bankowi dyspozycja przez dłużnika obciążenia jego rachunku określoną kwotą i uznania tą kwotą rachunku wierzyciela. Bank wykonuje dyspozycję w sposób przewidziany w umowie rachunku bankowego.",
  },
  {
    id: 18,
    topic: "Rynkowy system finansowy – instytucje",
    question:
      "Jakie rodzaje banków komercyjnych wyróżniamy?",
    options: [
      "Tylko banki uniwersalne",
      "Uniwersalne i specjalistyczne (inwestycyjne, hipoteczne)",
      "Tylko banki państwowe",
      "Banki centralne i komercyjne",
    ],
    correctIndex: 1,
    explanation:
      "Banki komercyjne dzielimy na: uniwersalne (prowadzą szeroki zakres działalności) i specjalistyczne, w tym inwestycyjne i hipoteczne.",
  },
  {
    id: 19,
    topic: "Rynkowy system finansowy – instytucje",
    question:
      "Wzór na realną stopę procentową to:",
    options: [
      "R(re) = r - i",
      "R(re) = (r - i) / (1 + i)",
      "R(re) = r × i",
      "R(re) = r / i",
    ],
    correctIndex: 1,
    explanation:
      "Realna stopa procentowa obliczana jest według wzoru Fishera: R(re) = (r - i) / (1 + i), gdzie r to nominalna stopa procentowa, a i to stopa inflacji.",
  },
  {
    id: 20,
    topic: "Rynkowy system finansowy – instytucje",
    question:
      "Cel polityki pieniężnej to:",
    options: [
      "Maksymalizacja zysków banków komercyjnych",
      "Stabilizowanie ogólnego poziomu cen – ograniczanie wahań wewnętrznej wartości pieniądza",
      "Zwiększanie podaży pieniądza",
      "Finansowanie deficytu budżetowego",
    ],
    correctIndex: 1,
    explanation:
      "Cel polityki pieniężnej to stabilizowanie ogólnego poziomu cen, a więc ograniczanie wahań wewnętrznej wartości pieniądza. Rozumiane jest to jako obniżanie stopy inflacji lub utrzymanie niskiej dynamiki stopy inflacji.",
  },

  // TOPIC 3: Instytucje ubezpieczeniowe i fundusze
  {
    id: 21,
    topic: "Instytucje ubezpieczeniowe i fundusze",
    question:
      "Co to jest ubezpieczenie według definicji ekonomicznej?",
    options: [
      "Forma oszczędzania w banku",
      "Urządzenie ekonomiczne, za pomocą którego jednostka zastępuje małym i pewnym kosztem dużą i niepewną stratę finansową",
      "Rodzaj kredytu bankowego",
      "Inwestycja na giełdzie",
    ],
    correctIndex: 1,
    explanation:
      "Ubezpieczenie to urządzenie ekonomiczne, za pomocą którego jednostka zastępuje małym i pewnym kosztem (składka) dużą i niepewną stratę finansową, która mogłaby powstać na skutek realizacji ryzyka.",
  },
  {
    id: 22,
    topic: "Instytucje ubezpieczeniowe i fundusze",
    question:
      "Jakie są główne funkcje ubezpieczenia?",
    options: [
      "Tylko wypłata odszkodowań",
      "Ochrony ubezpieczeniowej, akumulacji kapitału, prewencyjna, kompensacyjna",
      "Kredytowa i depozytowa",
      "Emisyjna i rozliczeniowa",
    ],
    correctIndex: 1,
    explanation:
      "Funkcje ubezpieczenia to: ochrony ubezpieczeniowej (zapewnienie ochrony przed skutkami zdarzeń losowych), akumulacji kapitału (gromadzenie składek i inwestowanie na rynku finansowym), prewencyjna (zmniejszanie strat) i kompensacyjna (wyrównywanie strat).",
  },
  {
    id: 23,
    topic: "Instytucje ubezpieczeniowe i fundusze",
    question:
      "Na czym polega idea wspólnego inwestowania?",
    options: [
      "Każdy inwestor działa samodzielnie",
      "Gromadzenie odrębnych i rozproszonych środków pieniężnych we wspólnym funduszu w celu uczestniczenia w lepiej zdywersyfikowanych portfelach inwestycyjnych",
      "Pożyczanie pieniędzy od banku",
      "Kupowanie nieruchomości",
    ],
    correctIndex: 1,
    explanation:
      "Idea wspólnego inwestowania polega na gromadzeniu odrębnych i rozproszonych środków pieniężnych we wspólnym funduszu (common pool) w celu uczestniczenia w lepiej zdywersyfikowanych portfelach inwestycyjnych niż w przypadku podejmowania indywidualnych działań.",
  },
  {
    id: 24,
    topic: "Instytucje ubezpieczeniowe i fundusze",
    question:
      "Czym różni się fundusz otwarty od zamkniętego?",
    options: [
      "Nie ma między nimi różnicy",
      "Otwarty wydaje nieograniczoną liczbę tytułów uczestnictwa umarzanych na żądanie; zamknięty emituje z góry określoną liczbę, zbywalne na rynku wtórnym",
      "Otwarty inwestuje tylko w obligacje, zamknięty w akcje",
      "Otwarty jest dla firm, zamknięty dla osób fizycznych",
    ],
    correctIndex: 1,
    explanation:
      "Fundusze otwarte mogą wydawać nieograniczoną liczbę tytułów uczestnictwa, umarzanych na żądanie po bieżącej cenie. Fundusze zamknięte emitują z góry określoną liczbę tytułów uczestnictwa, które inwestor może zbyć na rynku wtórnym.",
  },
  {
    id: 25,
    topic: "Instytucje ubezpieczeniowe i fundusze",
    question:
      "Jakie są przyczyny tworzenia funduszy wspólnego inwestowania?",
    options: [
      "Tylko chęć zysku",
      "Ograniczenie bezpośredniego dostępu do inwestycji, brak wiedzy, wysokie koszty transakcyjne, ryzyko pojedynczych operacji",
      "Wymóg prawny państwa",
      "Konieczność posiadania konta bankowego",
    ],
    correctIndex: 1,
    explanation:
      "Przyczyny tworzenia funduszy wspólnego inwestowania to: ograniczenie bezpośredniego dostępu do inwestycji finansowych (ograniczenia kapitałowe), brak wiedzy i doświadczenia, wysokie koszty transakcyjne operacji finansowych oraz ryzyko pojedynczych operacji finansowych.",
  },
  {
    id: 26,
    topic: "Instytucje ubezpieczeniowe i fundusze",
    question:
      "Jakie cechy instytucjonalne mają fundusze inwestycyjne?",
    options: [
      "Monetarne instytucje państwowe",
      "Niemonetarna, pośrednia instytucja finansowa, zbiorowy inwestor",
      "Banki komercyjne",
      "Instytucje bezpośredniego rynku finansowego",
    ],
    correctIndex: 1,
    explanation:
      "Fundusze inwestycyjne to niemonetarna, pośrednia instytucja finansowa i zbiorowy inwestor. Tworzą własne instrumenty finansowe (tytuły uczestnictwa), zaliczane są do instytucji pośredniego rynku finansowego.",
  },
  {
    id: 27,
    topic: "Instytucje ubezpieczeniowe i fundusze",
    question:
      "Jakie profile inwestycyjne funduszy wyróżniamy?",
    options: [
      "Tylko akcyjne",
      "Akcyjne, hybrydowe, obligacji, rynku pieniężnego, wyspecjalizowane",
      "Tylko bezpieczne i ryzykowne",
      "Krótkoterminowe i długoterminowe",
    ],
    correctIndex: 1,
    explanation:
      "Profile inwestycyjne funduszy to: akcyjne (agresywnego wzrostu, wzrostu, dochodu, indeksowe), hybrydowe (stabilnego wzrostu, zrównoważone), obligacji, rynku pieniężnego oraz wyspecjalizowane (branżowe, nieruchomości, private equity, hedge funds, fundusze funduszy).",
  },
  {
    id: 28,
    topic: "Instytucje ubezpieczeniowe i fundusze",
    question:
      "Kto zarządza funduszem inwestycyjnym?",
    options: [
      "Bank centralny",
      "Towarzystwo Funduszy Inwestycyjnych (TFI)",
      "Ministerstwo Finansów",
      "Giełda Papierów Wartościowych",
    ],
    correctIndex: 1,
    explanation:
      "Funduszem inwestycyjnym zarządza Towarzystwo Funduszy Inwestycyjnych (TFI). Analogicznie, funduszem emerytalnym zarządza Towarzystwo Funduszy Emerytalnych (TFE/PTE).",
  },
  {
    id: 29,
    topic: "Instytucje ubezpieczeniowe i fundusze",
    question:
      "Jakie niemonetarne instytucje finansowe tworzą własne instrumenty finansowe?",
    options: [
      "Tylko banki",
      "Fundusze ubezpieczeniowe, fundusze wspólnego inwestowania, domy maklerskie, instytucje rozliczeniowe, instytucje płatnicze",
      "Tylko giełda papierów wartościowych",
      "Wyłącznie bank centralny",
    ],
    correctIndex: 1,
    explanation:
      "Niemonetarne instytucje finansowe tworzące własne instrumenty to: fundusze ubezpieczeniowe, fundusze wspólnego inwestowania, domy maklerskie, instytucje rozliczeniowe i instytucje płatnicze. Należą do instytucji pośredniego rynku finansowego.",
  },
  {
    id: 30,
    topic: "Instytucje ubezpieczeniowe i fundusze",
    question:
      "Czym jest funkcja prewencyjna ubezpieczeń?",
    options: [
      "Wypłata odszkodowań po szkodzie",
      "Działania mające na celu zmniejszenie strat – przez ograniczanie ich rozmiarów lub zmniejszanie prawdopodobieństwa wystąpienia zdarzeń losowych",
      "Gromadzenie składek ubezpieczeniowych",
      "Inwestowanie na rynku kapitałowym",
    ],
    correctIndex: 1,
    explanation:
      "Funkcja prewencyjna realizowana jest przez działania mające na celu zmniejszenie strat: albo przez ograniczanie ich rozmiarów (działania tłumiące), albo przez zmniejszanie prawdopodobieństwa wystąpienia zdarzeń losowych. Środki prewencji mogą być prawne, ekonomiczne i techniczne.",
  },

  // TOPIC 4: Publiczny system finansowy
  {
    id: 31,
    topic: "Publiczny system finansowy",
    question:
      "Jakie instytucje tworzą strukturę publicznego systemu finansowego?",
    options: [
      "Tylko budżet państwa",
      "Budżet państwa, budżety JST, fundusze celowe",
      "Banki i giełda",
      "Przedsiębiorstwa państwowe",
    ],
    correctIndex: 1,
    explanation:
      "Strukturę publicznego systemu finansowego tworzą trzy instytucje: budżet państwa, budżety jednostek samorządu terytorialnego (JST) i fundusze celowe. Działają one w oparciu o normy prawne (Konstytucja, ustawy, rozporządzenia).",
  },
  {
    id: 32,
    topic: "Publiczny system finansowy",
    question:
      "Jakie są trzy funkcje finansów publicznych?",
    options: [
      "Emisyjna, kredytowa, lokacyjna",
      "Alokacyjna, redystrybucyjna, stabilizacyjna",
      "Fiskalna, monetarna, handlowa",
      "Produkcyjna, konsumpcyjna, oszczędnościowa",
    ],
    correctIndex: 1,
    explanation:
      "Funkcje finansów publicznych to: alokacyjna (jakie dobra publiczne wytwarzać, na czyją rzecz i w jakiej ilości – mechanizm polityczny), redystrybucyjna (wtórny podział dochodu narodowego) i stabilizacyjna (łagodzenie wahań cyklu gospodarczego).",
  },
  {
    id: 33,
    topic: "Publiczny system finansowy",
    question:
      "Czym różni się podatek od pożyczki publicznej?",
    options: [
      "Niczym się nie różnią",
      "Podatek jest przymusowy, bezzwrotny, nieodpłatny; pożyczka jest dobrowolna, zwrotna, odpłatna",
      "Podatek jest dobrowolny, a pożyczka przymusowa",
      "Podatek dotyczy tylko firm, pożyczka – osób fizycznych",
    ],
    correctIndex: 1,
    explanation:
      "Podatek to dochód przymusowy, bezzwrotny, nieodpłatny o przeznaczeniu ogólnym. Pożyczka publiczna to przychód dobrowolny, zwrotny, odpłatny (generuje odsetki) o przeznaczeniu ogólnym lub celowym. Podatek obciąża bieżące pokolenie, a pożyczkę spłaca bieżące lub przyszłe pokolenie.",
  },
  {
    id: 34,
    topic: "Publiczny system finansowy",
    question:
      "Jakie są cechy stałe podatku?",
    options: [
      "Wysokość stawki i podstawa opodatkowania",
      "Pieniężna forma, przymusowość, jednostronność ustalania, ogólny charakter, bezzwrotność, nieodpłatność, przewłaszczenie",
      "Dobrowolność i zwrotność",
      "Celowość i okresowość",
    ],
    correctIndex: 1,
    explanation:
      "Cechy stałe podatku to: pieniężna forma, przymusowość, jednostronność ustalania, ogólny charakter, bezzwrotność, nieodpłatność i przewłaszczenie (przeniesienie własności środków na rzecz państwa).",
  },
  {
    id: 35,
    topic: "Publiczny system finansowy",
    question:
      "Czym różni się budżet od funduszu celowego?",
    options: [
      "Nie ma różnicy",
      "Budżet opiera się na zasadzie niefunduszowania (finansowanie ogólne, roczność); fundusz celowy – na zasadzie funduszowania (finansowanie celowe, wieloletność)",
      "Budżet jest tylko roczny, a fundusz tylko wieloletni",
      "Fundusz celowy jest większy niż budżet",
    ],
    correctIndex: 1,
    explanation:
      "Budżet opiera się na zasadzie niefunduszowania (finansowanie ogólne) i roczności. Fundusz celowy opiera się na zasadzie funduszowania (finansowanie celowe) i wieloletności. W budżecie trudniej nałożyć nowy podatek, ale łatwiej ukryć wydatki. W funduszu – odwrotnie.",
  },
  {
    id: 36,
    topic: "Publiczny system finansowy",
    question:
      "Jakie są trzy fazy ewolucji zadań państwa?",
    options: [
      "Produkcja, handel, usługi",
      "Zapewnienie wolności i własności → dobra socjalne → interwencja w procesy rynkowe",
      "Militarna, ekonomiczna, kulturalna",
      "Feudalna, kapitalistyczna, socjalistyczna",
    ],
    correctIndex: 1,
    explanation:
      "Trzy fazy: 1) zapewnienie wolności i własności w zamian za rezygnację z części praw i dochodów, 2) rozszerzenie o działania związane z poprawą dostępności do dóbr socjalnych, 3) potrzeba interwencji w procesy rynkowe generujące kryzysy gospodarcze.",
  },
  {
    id: 37,
    topic: "Publiczny system finansowy",
    question:
      "Czym jest sektor finansów publicznych?",
    options: [
      "Wszystkie przedsiębiorstwa w państwie",
      "Część sektora publicznego, która wykorzystuje środki publiczne do realizacji zadań państwa",
      "Sektor bankowy",
      "Sektor prywatnych przedsiębiorstw",
    ],
    correctIndex: 1,
    explanation:
      "Sektor finansów publicznych to część sektora publicznego, która wykorzystuje środki publiczne do realizacji zadań państwa. Dzieli się na: rządowy, samorządowy i ubezpieczeń społecznych.",
  },
  {
    id: 38,
    topic: "Publiczny system finansowy",
    question:
      "Jakie są elementy techniki podatkowej (cechy zmienne podatku)?",
    options: [
      "Tylko stawka podatkowa",
      "Podmiot podatku, przedmiot podatku, podstawa opodatkowania, stawki i skale podatkowe, zwolnienia/ulgi/zwyżki",
      "Forma pieniężna i przymusowość",
      "Bezzwrotność i nieodpłatność",
    ],
    correctIndex: 1,
    explanation:
      "Elementy techniki podatkowej (cechy zmienne) to: podmiot podatku (kto płaci), przedmiot podatku (co jest opodatkowane), podstawa opodatkowania (od czego liczymy), stawki i skale podatkowe (ile płacimy), zwolnienia, ulgi i zwyżki.",
  },
  {
    id: 39,
    topic: "Publiczny system finansowy",
    question:
      "Czym różni się państwo minimalne od państwa socjalnego?",
    options: [
      "Niczym się nie różnią",
      "Państwo minimalne realizuje tylko zadania publiczne (mała redystrybucja); socjalne – także zadania społeczne i ekonomiczne (wysoka redystrybucja)",
      "Państwo minimalne ma wyższe podatki",
      "Państwo socjalne nie ma budżetu",
    ],
    correctIndex: 1,
    explanation:
      "Państwo minimalne realizuje tylko zadania publiczne (klasyczne), ma małą redystrybucję i dostarcza klasyczne dobra publiczne. Państwo socjalne realizuje też zadania społeczne i ekonomiczne, ma wysoką redystrybucję i dostarcza dobra publiczne oraz społeczne.",
  },
  {
    id: 40,
    topic: "Publiczny system finansowy",
    question:
      "Co to są instrumenty fiskalne?",
    options: [
      "Instrumenty polityki monetarnej",
      "Daniny publiczne – przymusowe i bezzwrotne obciążenia nakładane na podmioty przez państwo",
      "Obligacje skarbowe",
      "Kredyty dla przedsiębiorstw",
    ],
    correctIndex: 1,
    explanation:
      "Instrumenty fiskalne to daniny publiczne – przymusowe i bezzwrotne obciążenia nakładane na podmioty przez państwo (np. podatki). Obok nich istnieją instrumenty pozafiskalne: stymulacyjne, prohibicyjne i sankcyjne.",
  },

  // TOPIC 5: Finanse a ryzyko
  {
    id: 41,
    topic: "Finanse a ryzyko",
    question:
      "Jakie dwa elementy zawierają wszystkie definicje ryzyka?",
    options: [
      "Zysk i strata",
      "Nieokreśloność i strata",
      "Pewność i dochód",
      "Inflacja i deflacja",
    ],
    correctIndex: 1,
    explanation:
      "Chociaż nie można wskazać jednej uniwersalnej definicji ryzyka, wszystkie definicje zawierają dwa powszechnie występujące elementy: nieokreśloność (niepewność co do wyniku) i strata (możliwość poniesienia straty).",
  },
  {
    id: 42,
    topic: "Finanse a ryzyko",
    question:
      "Czym różni się negatywna koncepcja ryzyka od neutralnej?",
    options: [
      "Nie ma różnicy",
      "Negatywna traktuje ryzyko tylko jako zagrożenie; neutralna – zarówno jako zagrożenie, jak i szansę",
      "Negatywna dotyczy finansów, neutralna – polityki",
      "Negatywna jest stosowana w bankach, neutralna – w ubezpieczeniach",
    ],
    correctIndex: 1,
    explanation:
      "Negatywna koncepcja ryzyka traktuje ryzyko wyłącznie jako zagrożenie (możliwość straty) – jest charakterystyczna dla ubezpieczeń. Neutralna koncepcja traktuje ryzyko zarówno jako zagrożenie, jak i szansę – wynik może być gorszy lub lepszy od oczekiwanego.",
  },
  {
    id: 43,
    topic: "Finanse a ryzyko",
    question:
      "Czym różni się ryzyko czyste od spekulacyjnego?",
    options: [
      "Ryzyko czyste dotyczy giełdy, spekulacyjne – ubezpieczeń",
      "Ryzyko czyste ma dwa wyniki: strata lub brak straty; spekulacyjne ma trzy: strata, brak straty/zysku, zysk",
      "Ryzyko czyste jest większe od spekulacyjnego",
      "Nie ma między nimi różnicy",
    ],
    correctIndex: 1,
    explanation:
      "Ryzyko czyste ma dwa możliwe wyniki: strata lub brak straty (np. ryzyko pożaru). Ryzyko spekulacyjne ma trzy możliwe wyniki: strata, brak straty/zysku, lub zysk (np. ryzyko inwestycyjne na giełdzie).",
  },
  {
    id: 44,
    topic: "Finanse a ryzyko",
    question:
      "Jakie są trzy elementy ryzyka finansowego?",
    options: [
      "Inflacja, deflacja, stagflacja",
      "Osoba/organizacja narażona na straty, aktywa/dochód mogące być utracone, niebezpieczeństwo mogące spowodować stratę",
      "Bank, kredyt, depozyt",
      "Podatek, subwencja, dotacja",
    ],
    correctIndex: 1,
    explanation:
      "Trzy elementy ryzyka finansowego to: (1) osoba lub organizacja narażona na straty, (2) aktywa lub dochód, których zniszczenie lub utrata spowoduje finansową stratę, (3) niebezpieczeństwo, które może spowodować stratę.",
  },
  {
    id: 45,
    topic: "Finanse a ryzyko",
    question:
      "Na jakie podkategorie dzieli się ryzyko finansowe?",
    options: [
      "Tylko ryzyko inflacyjne",
      "Ryzyko rynkowe, ryzyko kredytowe, ryzyko ceny",
      "Ryzyko polityczne i prawne",
      "Ryzyko demograficzne i klimatyczne",
    ],
    correctIndex: 1,
    explanation:
      "Ryzyko finansowe dzieli się na: ryzyko rynkowe (zmiany wartości aktywów), ryzyko kredytowe (niedotrzymanie warunków przez drugą stronę) i ryzyko ceny.",
  },
  {
    id: 46,
    topic: "Finanse a ryzyko",
    question:
      "Co to jest ryzyko systematyczne i niesystematyczne?",
    options: [
      "Systematyczne dotyczy jednej firmy, niesystematyczne – całej gospodarki",
      "Ryzyko rynkowe dotyczy całej gospodarki (systematyczne); ryzyko kredytowe i płynności dotyczy jednej firmy (niesystematyczne, kontrolowane)",
      "Oba dotyczą tylko banków",
      "Systematyczne jest mniejsze od niesystematycznego",
    ],
    correctIndex: 1,
    explanation:
      "Ryzyko systematyczne (rynkowe) dotyczy społeczeństwa lub gospodarki jako całości i nie może być kontrolowane przez pojedynczą firmę. Ryzyko niesystematyczne (np. kredytowe, płynności) odnosi się jedynie do firmy lub jednostki i może być przez nie kontrolowane.",
  },
  {
    id: 47,
    topic: "Finanse a ryzyko",
    question:
      "Jakie są metody postępowania z ryzykiem?",
    options: [
      "Tylko ubezpieczenie",
      "Unikanie, zatrzymanie (pasywne/aktywne), redukcja, transfer (przeniesienie), podział ryzyka",
      "Tylko oszczędzanie",
      "Tylko dywersyfikacja",
    ],
    correctIndex: 1,
    explanation:
      "Metody postępowania z ryzykiem to: unikanie (nieakceptowanie ryzyka), zatrzymanie (pasywne – z braku świadomości, aktywne – świadome), redukcja (zmniejszanie prawdopodobieństwa lub skutków), transfer/przeniesienie (np. ubezpieczenie), podział (rozłożenie na zbiorowość).",
  },
  {
    id: 48,
    topic: "Finanse a ryzyko",
    question:
      "Jakie są sposoby finansowania ryzyka?",
    options: [
      "Tylko kredyt bankowy",
      "Oszczędności (rezerwy), kredyt (pożyczka), sprzedaż składników majątku, ubezpieczenie",
      "Tylko z budżetu państwa",
      "Tylko z zysków operacyjnych",
    ],
    correctIndex: 1,
    explanation:
      "Finansowanie ryzyka obejmuje: oszczędności (rezerwy), kredyt (pożyczka), sprzedaż składników rzeczowych majątku (np. zapasów, gruntów, budynków) oraz ubezpieczenie.",
  },
  {
    id: 49,
    topic: "Finanse a ryzyko",
    question:
      "Czym jest ryzyko stopy procentowej przy stałej stopie?",
    options: [
      "Nie ma ryzyka przy stałej stopie",
      "Generuje stałe przepływy pieniężne, ale może powodować straty dla wierzyciela (gdy rynkowa stopa rośnie) lub dłużnika (gdy rynkowa stopa maleje)",
      "Zawsze jest korzystne dla obu stron",
      "Dotyczy tylko kredytów hipotecznych",
    ],
    correctIndex: 1,
    explanation:
      "Stała stopa procentowa generuje stałą wartość przepływów pieniężnych, ale odchylenie od rynkowej stopy może powodować: straty dla wierzyciela (korzyści dłużnika) gdy stopa rynkowa rośnie, lub straty dla dłużnika (korzyści wierzyciela) gdy stopa rynkowa maleje.",
  },
  {
    id: 50,
    topic: "Finanse a ryzyko",
    question:
      "Jakie instrumenty służą transferowi ryzyka?",
    options: [
      "Tylko depozyty bankowe",
      "Ubezpieczenie i instrumenty pochodne",
      "Tylko obligacje skarbowe",
      "Wyłącznie fundusze inwestycyjne",
    ],
    correctIndex: 1,
    explanation:
      "Transfer ryzyka realizowany jest głównie za pomocą: ubezpieczenia (przeniesienie ciężaru poniesienia skutków ryzyka na ubezpieczyciela) oraz instrumentów pochodnych (derywatów). Przeniesienie dotyczy ciężaru skutków, nie samego ryzyka.",
  },
];

export const flashcards: Flashcard[] = [
  // Topic 1
  {
    id: 1,
    topic: "Funkcjonalność i funkcje finansów",
    front: "Trzy funkcje współczesnych finansów",
    back: "1. Alokacyjna – rozmieszczenie zasobów\n2. Redystrybucyjna – wtórny podział dochodu\n3. Stabilizacyjna – łagodzenie wahań koniunktury",
  },
  {
    id: 2,
    topic: "Funkcjonalność i funkcje finansów",
    front: "Redystrybucja – definicja",
    back: "Podział wtórny dochodu narodowego. Z finansowej perspektywy – przemieszczanie się pieniądza między podmiotami z innych przyczyn niż wymiana dóbr. Jeden podmiot przekazuje część swojej siły nabywczej na rzecz innego.",
  },
  {
    id: 3,
    topic: "Funkcjonalność i funkcje finansów",
    front: "Motywy akumulacji oszczędności",
    back: "1. Transakcyjny – na bieżące potrzeby\n2. Ostrożnościowy – na wypadek nieprzewidzianych zdarzeń\n3. Spekulacyjny – w oczekiwaniu na korzystne okazje",
  },
  {
    id: 4,
    topic: "Funkcjonalność i funkcje finansów",
    front: "Kryteria alokacji kapitału",
    back: "1. Płynność\n2. Dochodowość\n3. Ryzyko\n4. Bezpieczeństwo",
  },
  {
    id: 5,
    topic: "Funkcjonalność i funkcje finansów",
    front: "Rodzaje stóp procentowych",
    back: "• Nominalna – zawarta w umowie\n• Efektywna – uwzględnia kapitalizację\n• Realna – efektywna skorygowana o inflację\n• Rzeczywista – uwzględnia też inne koszty (np. prowizja)",
  },
  {
    id: 6,
    topic: "Funkcjonalność i funkcje finansów",
    front: "Transformacja oszczędności w kapitał",
    back: "Bezpośrednia: oszczędności → instrumenty finansowe → kapitał przedsiębiorstw\nPośrednia: oszczędności → instrumenty fin. → instytucje finansowe → instrumenty fin. → kapitał przedsiębiorstw\nPośrednia zwiększa dostępność kapitału, daje większą płynność i mniejsze ryzyko.",
  },

  // Topic 2
  {
    id: 7,
    topic: "Rynkowy system finansowy – instytucje",
    front: "Struktura rynkowego systemu finansowego",
    back: "4 elementy:\n1. Instytucje (monetarne, niemonetarne)\n2. Instrumenty (tworzące siłę nabywczą, przenoszące, płatnicze)\n3. Rynki (kapitałowy, pieniężny)\n4. Zasady (normy prawne, rekomendacje, normy zwyczajowe)",
  },
  {
    id: 8,
    topic: "Rynkowy system finansowy – instytucje",
    front: "Funkcje banku centralnego",
    back: "1. Bank emisyjny – emituje pieniądz gotówkowy, reguluje podaż pieniądza\n2. Bank państwa – polityka monetarna, rachunki rządu, rezerwy złota i dewiz\n3. Bank banków – przechowuje rezerwy, źródło rezerwy kredytowej, rozrachunki",
  },
  {
    id: 9,
    topic: "Rynkowy system finansowy – instytucje",
    front: "Instrumenty polityki pieniężnej",
    back: "Podstawowe:\n• Stopa rezerwy obowiązkowej\n• Stopy kredytów refinansowych (lombardowy, redyskontowy)\n• Operacje otwartego rynku\n\nDodatkowo: instrumenty selektywne (administracyjne)",
  },
  {
    id: 10,
    topic: "Rynkowy system finansowy – instytucje",
    front: "Operacje bankowe – rodzaje",
    back: "• Pasywne (bierne) – pozyskiwanie środków (depozyty, emisja papierów)\n• Aktywne (czynne) – wykorzystanie środków (kredyty, gwarancje, poręczenia)\n• Rozliczeniowe – realizacja zleceń płatniczych\n• Inne – przechowywanie, doradztwo",
  },
  {
    id: 11,
    topic: "Rynkowy system finansowy – instytucje",
    front: "Składniki oprocentowania kredytów",
    back: "Oprocentowanie depozytów\n+ Koszty działalności banku\n+ Koszty zabezpieczenia depozytów\n+ Koszt alternatywny rezerwy obowiązkowej\n+ Marża bankowa\n+ Premia za ryzyko\n+ Zysk",
  },
  {
    id: 12,
    topic: "Rynkowy system finansowy – instytucje",
    front: "Wzór na realną stopę procentową (Fisher)",
    back: "R(re) = (r - i) / (1 + i)\n\ngdzie:\nr = nominalna stopa procentowa\ni = stopa inflacji",
  },

  // Topic 3
  {
    id: 13,
    topic: "Instytucje ubezpieczeniowe i fundusze",
    front: "Definicja ubezpieczenia",
    back: "Urządzenie ekonomiczne, za pomocą którego jednostka zastępuje małym i pewnym kosztem (składka) dużą i niepewną stratę finansową, która mogłaby powstać na skutek realizacji ryzyka. Opiera się na rozłożeniu ciężaru pokrycia strat na wiele jednostek.",
  },
  {
    id: 14,
    topic: "Instytucje ubezpieczeniowe i fundusze",
    front: "Funkcje ubezpieczenia",
    back: "1. Ochrony ubezpieczeniowej – zapewnienie ochrony\n2. Akumulacji kapitału – gromadzenie składek, inwestowanie\n3. Prewencyjna – zmniejszanie strat (tłumienie, prewencja)\n4. Kompensacyjna – wyrównywanie strat (odszkodowania)",
  },
  {
    id: 15,
    topic: "Instytucje ubezpieczeniowe i fundusze",
    front: "Fundusze otwarte vs zamknięte",
    back: "Otwarte: nieograniczona liczba tytułów uczestnictwa, umarzane na żądanie po bieżącej cenie, brak obrotu\nZamknięte: z góry określona liczba tytułów, zbywalne na rynku wtórnym, cena rynkowa może różnić się od NAV",
  },
  {
    id: 16,
    topic: "Instytucje ubezpieczeniowe i fundusze",
    front: "Cechy funduszy inwestycyjnych",
    back: "Instytucjonalne: niemonetarna, pośrednia instytucja finansowa, zbiorowy inwestor\nFunkcjonalne: akumulacja, transformacja, alokacja, dywersyfikacja\nTworzą własne instrumenty (tytuły uczestnictwa).",
  },
  {
    id: 17,
    topic: "Instytucje ubezpieczeniowe i fundusze",
    front: "Profile inwestycyjne funduszy",
    back: "• Akcyjne (agresywnego wzrostu, wzrostu, dochodu, indeksowe)\n• Hybrydowe (stabilnego wzrostu, zrównoważone)\n• Obligacji\n• Rynku pieniężnego\n• Wyspecjalizowane (branżowe, nieruchomości, PE, hedge, fundusze funduszy)",
  },

  // Topic 4
  {
    id: 18,
    topic: "Publiczny system finansowy",
    front: "Struktura publicznego systemu finansowego",
    back: "Instytucje: budżet państwa, budżety JST, fundusze celowe\nInstrumenty: fiskalne (daniny publiczne), pozafiskalne (stymulacyjne, prohibicyjne, sankcyjne)\nZasady: Konstytucja, ustawy, rozporządzenia",
  },
  {
    id: 19,
    topic: "Publiczny system finansowy",
    front: "Podatek – cechy stałe",
    back: "• Pieniężna forma\n• Przymusowość\n• Jednostronność ustalania\n• Ogólny charakter\n• Bezzwrotność\n• Nieodpłatność\n• Przewłaszczenie",
  },
  {
    id: 20,
    topic: "Publiczny system finansowy",
    front: "Podatek vs pożyczka publiczna",
    back: "Podatek: przymusowy, bezzwrotny, nieodpłatny, ogólny, obciąża bieżące pokolenie, nie generuje dodatkowych kosztów\nPożyczka: dobrowolna, zwrotna, odpłatna (odsetki), korzysta bieżące pokolenie ale spłaca przyszłe, generuje koszty odsetek",
  },
  {
    id: 21,
    topic: "Publiczny system finansowy",
    front: "Budżet vs fundusz celowy",
    back: "Budżet: zasada niefunduszowania, finansowanie ogólne, roczność, trudniej nałożyć podatek, łatwiej ukryć wydatki\nFundusz celowy: zasada funduszowania, finansowanie celowe, wieloletność, łatwiej nałożyć podatek, trudniej ukryć wydatki",
  },
  {
    id: 22,
    topic: "Publiczny system finansowy",
    front: "Funkcje finansów publicznych",
    back: "1. Alokacyjna – jakie dobra publiczne wytwarzać, na czyją rzecz i w jakiej ilości (mechanizm polityczny)\n2. Redystrybucyjna – wtórny podział dochodu narodowego (gromadzenie dochodów i wydatki)\n3. Stabilizacyjna – łagodzenie wahań cyklu gospodarczego (narzędzia stymulujące/hamujące popyt)",
  },

  // Topic 5
  {
    id: 23,
    topic: "Finanse a ryzyko",
    front: "Definicja ryzyka w finansach",
    back: "Ryzyko = możliwość wystąpienia odchylenia (ujemnego lub dodatniego) od stanu oczekiwanego, które da się w sposób wiarygodny oszacować.\nDotyczy: zmian przepływów pieniężnych lub zmian wartości aktywów.",
  },
  {
    id: 24,
    topic: "Finanse a ryzyko",
    front: "Ryzyko czyste vs spekulacyjne",
    back: "Czyste: wyniki to STRATA lub BRAK STRATY (np. ubezpieczenia)\nSpekulacyjne: wyniki to STRATA, BRAK STRATY/ZYSKU, lub ZYSK (np. inwestycje na giełdzie)",
  },
  {
    id: 25,
    topic: "Finanse a ryzyko",
    front: "Trzy elementy ryzyka finansowego",
    back: "1. Osoba lub organizacja narażona na straty\n2. Aktywa lub dochód, których utrata spowoduje stratę finansową\n3. Niebezpieczeństwo, które może spowodować stratę",
  },
  {
    id: 26,
    topic: "Finanse a ryzyko",
    front: "Ryzyko systematyczne vs niesystematyczne",
    back: "Systematyczne (rynkowe): dotyczy całej gospodarki, nie da się kontrolować (np. ryzyko kursowe, stopy procentowej)\nNiesystematyczne: dotyczy jednej firmy, można je kontrolować (np. ryzyko kredytowe, płynności)",
  },
  {
    id: 27,
    topic: "Finanse a ryzyko",
    front: "Metody postępowania z ryzykiem",
    back: "1. Unikanie – nieakceptowanie obecności ryzyka\n2. Zatrzymanie – pasywne (brak świadomości) lub aktywne (świadome)\n3. Redukcja – zmniejszanie prawdopodobieństwa lub skutków\n4. Transfer/przeniesienie – np. ubezpieczenie, instrumenty pochodne\n5. Podział – rozłożenie na zbiorowość (spółka, fundusz)",
  },
  {
    id: 28,
    topic: "Finanse a ryzyko",
    front: "Sposoby finansowania i podziału ryzyka",
    back: "Finansowanie: oszczędności, kredyt, sprzedaż majątku, ubezpieczenie\nPodział: ubezpieczenie, wspólny fundusz (spółka, FI), dywersyfikacja\nTransfer: ubezpieczenie, instrumenty pochodne",
  },
];
