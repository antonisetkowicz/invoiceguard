"use client";

import { useState, useCallback, useMemo } from "react";
import {
  questions,
  flashcards,
  TOPICS,
  TOPIC_COLORS,
  type Topic,
  type Question,
  type Flashcard,
} from "./data";

type Mode = "menu" | "quiz" | "flashcards" | "results" | "review";

interface QuizState {
  currentIndex: number;
  answers: (number | null)[];
  showExplanation: boolean;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function ExamPrepPage() {
  const [mode, setMode] = useState<Mode>("menu");
  const [selectedTopics, setSelectedTopics] = useState<Set<Topic>>(
    new Set(TOPICS)
  );
  const [quizQuestions, setQuizQuestions] = useState<Question[]>([]);
  const [quiz, setQuiz] = useState<QuizState>({
    currentIndex: 0,
    answers: [],
    showExplanation: false,
  });
  const [flashcardIndex, setFlashcardIndex] = useState(0);
  const [flashcardFlipped, setFlashcardFlipped] = useState(false);
  const [filteredFlashcards, setFilteredFlashcards] = useState<Flashcard[]>([]);
  const [quizSize, setQuizSize] = useState(10);

  const toggleTopic = (topic: Topic) => {
    setSelectedTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topic)) {
        if (next.size > 1) next.delete(topic);
      } else {
        next.add(topic);
      }
      return next;
    });
  };

  const startQuiz = useCallback(() => {
    const filtered = questions.filter((q) =>
      selectedTopics.has(q.topic as Topic)
    );
    const shuffled = shuffleArray(filtered).slice(0, quizSize);
    setQuizQuestions(shuffled);
    setQuiz({
      currentIndex: 0,
      answers: new Array(shuffled.length).fill(null),
      showExplanation: false,
    });
    setMode("quiz");
  }, [selectedTopics, quizSize]);

  const startFlashcards = useCallback(() => {
    const filtered = flashcards.filter((f) =>
      selectedTopics.has(f.topic as Topic)
    );
    setFilteredFlashcards(shuffleArray(filtered));
    setFlashcardIndex(0);
    setFlashcardFlipped(false);
    setMode("flashcards");
  }, [selectedTopics]);

  const selectAnswer = (optionIndex: number) => {
    if (quiz.answers[quiz.currentIndex] !== null) return;
    setQuiz((prev) => {
      const newAnswers = [...prev.answers];
      newAnswers[prev.currentIndex] = optionIndex;
      return { ...prev, answers: newAnswers, showExplanation: true };
    });
  };

  const nextQuestion = () => {
    if (quiz.currentIndex < quizQuestions.length - 1) {
      setQuiz((prev) => ({
        ...prev,
        currentIndex: prev.currentIndex + 1,
        showExplanation: false,
      }));
    } else {
      setMode("results");
    }
  };

  const score = useMemo(() => {
    let correct = 0;
    quiz.answers.forEach((answer, i) => {
      if (answer === quizQuestions[i]?.correctIndex) correct++;
    });
    return correct;
  }, [quiz.answers, quizQuestions]);

  const scorePercent = quizQuestions.length
    ? Math.round((score / quizQuestions.length) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
      <header className="border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => setMode("menu")}
            className="flex items-center gap-2 hover:text-blue-400 transition-colors"
          >
            <span className="text-2xl font-bold tracking-tight">
              Podstawy Finansów
            </span>
          </button>
          <span className="text-sm text-slate-400">
            Przygotowanie do egzaminu
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {mode === "menu" && (
          <MenuView
            selectedTopics={selectedTopics}
            toggleTopic={toggleTopic}
            quizSize={quizSize}
            setQuizSize={setQuizSize}
            startQuiz={startQuiz}
            startFlashcards={startFlashcards}
            totalQuestions={
              questions.filter((q) => selectedTopics.has(q.topic as Topic))
                .length
            }
            totalFlashcards={
              flashcards.filter((f) => selectedTopics.has(f.topic as Topic))
                .length
            }
          />
        )}

        {mode === "quiz" && quizQuestions.length > 0 && (
          <QuizView
            question={quizQuestions[quiz.currentIndex]}
            currentIndex={quiz.currentIndex}
            total={quizQuestions.length}
            selectedAnswer={quiz.answers[quiz.currentIndex]}
            showExplanation={quiz.showExplanation}
            onSelectAnswer={selectAnswer}
            onNext={nextQuestion}
            onQuit={() => setMode("menu")}
            score={score}
          />
        )}

        {mode === "flashcards" && filteredFlashcards.length > 0 && (
          <FlashcardView
            card={filteredFlashcards[flashcardIndex]}
            currentIndex={flashcardIndex}
            total={filteredFlashcards.length}
            flipped={flashcardFlipped}
            onFlip={() => setFlashcardFlipped(!flashcardFlipped)}
            onNext={() => {
              setFlashcardFlipped(false);
              setFlashcardIndex((i) =>
                i < filteredFlashcards.length - 1 ? i + 1 : 0
              );
            }}
            onPrev={() => {
              setFlashcardFlipped(false);
              setFlashcardIndex((i) =>
                i > 0 ? i - 1 : filteredFlashcards.length - 1
              );
            }}
            onQuit={() => setMode("menu")}
          />
        )}

        {mode === "results" && (
          <ResultsView
            score={score}
            total={quizQuestions.length}
            percent={scorePercent}
            onReview={() => setMode("review")}
            onRetry={startQuiz}
            onMenu={() => setMode("menu")}
          />
        )}

        {mode === "review" && (
          <ReviewView
            questions={quizQuestions}
            answers={quiz.answers}
            onMenu={() => setMode("menu")}
            onRetry={startQuiz}
          />
        )}
      </main>
    </div>
  );
}

function MenuView({
  selectedTopics,
  toggleTopic,
  quizSize,
  setQuizSize,
  startQuiz,
  startFlashcards,
  totalQuestions,
  totalFlashcards,
}: {
  selectedTopics: Set<Topic>;
  toggleTopic: (t: Topic) => void;
  quizSize: number;
  setQuizSize: (n: number) => void;
  startQuiz: () => void;
  startFlashcards: () => void;
  totalQuestions: number;
  totalFlashcards: number;
}) {
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
          Podstawy Finansów – Egzamin
        </h1>
        <p className="text-slate-400 text-lg">
          Dr Piotr Kania &middot; UE Katowice &middot; 2025/26L
        </p>
      </div>

      <div className="bg-slate-800/50 rounded-2xl p-6 border border-slate-700/50">
        <h2 className="text-lg font-semibold mb-4 text-slate-200">
          Wybierz tematy
        </h2>
        <div className="space-y-2">
          {TOPICS.map((topic) => {
            const active = selectedTopics.has(topic);
            const color = TOPIC_COLORS[topic];
            return (
              <button
                key={topic}
                onClick={() => toggleTopic(topic)}
                className={`w-full text-left px-4 py-3 rounded-xl transition-all flex items-center gap-3 ${
                  active
                    ? "bg-slate-700/70 border border-slate-600"
                    : "bg-slate-800/30 border border-slate-700/30 opacity-50"
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full ${color} ${
                    active ? "" : "opacity-30"
                  }`}
                />
                <span className={active ? "text-white" : "text-slate-500"}>
                  {topic}
                </span>
                {active && (
                  <span className="ml-auto text-xs text-slate-400">&#10003;</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="bg-slate-800/50 rounded-2xl p-6 border border-slate-700/50">
        <h2 className="text-lg font-semibold mb-4 text-slate-200">
          Liczba pytań w quizie
        </h2>
        <div className="flex gap-2">
          {[5, 10, 15, 20, totalQuestions].map((n) => (
            <button
              key={n}
              onClick={() => setQuizSize(n)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                quizSize === n
                  ? "bg-blue-600 text-white"
                  : "bg-slate-700/50 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {n === totalQuestions ? `Wszystkie (${n})` : n}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={startQuiz}
          className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 rounded-2xl p-6 text-left transition-all hover:scale-[1.02] active:scale-[0.98] border border-blue-500/30"
        >
          <div className="text-3xl mb-3">&#x1F4DD;</div>
          <h3 className="text-xl font-bold mb-1">Quiz</h3>
          <p className="text-blue-200 text-sm">
            {Math.min(quizSize, totalQuestions)} pytań wielokrotnego wyboru z
            wyjaśnieniami
          </p>
          <p className="text-blue-300/60 text-xs mt-2">
            Dostępne: {totalQuestions} pytań
          </p>
        </button>

        <button
          onClick={startFlashcards}
          className="bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 rounded-2xl p-6 text-left transition-all hover:scale-[1.02] active:scale-[0.98] border border-purple-500/30"
        >
          <div className="text-3xl mb-3">&#x1F4DA;</div>
          <h3 className="text-xl font-bold mb-1">Fiszki</h3>
          <p className="text-purple-200 text-sm">
            Przeglądaj definicje i kluczowe pojęcia
          </p>
          <p className="text-purple-300/60 text-xs mt-2">
            Dostępne: {totalFlashcards} fiszek
          </p>
        </button>
      </div>

      <div className="bg-slate-800/30 rounded-2xl p-6 border border-slate-700/30">
        <h2 className="text-lg font-semibold mb-3 text-slate-300">
          Tematy na egzaminie
        </h2>
        <div className="space-y-4 text-sm text-slate-400">
          <div>
            <span className="inline-block w-3 h-3 rounded-full bg-blue-500 mr-2" />
            <strong className="text-slate-300">Wykład 4:</strong>{" "}
            Funkcjonalność finansów, funkcje (alokacyjna, redystrybucyjna,
            stabilizacyjna), stopa procentowa, transformacja oszczędności w
            kapitał
          </div>
          <div>
            <span className="inline-block w-3 h-3 rounded-full bg-emerald-500 mr-2" />
            <strong className="text-slate-300">Wykład 6 (cz. 3):</strong>{" "}
            Rynkowy system finansowy, bank centralny, banki komercyjne,
            polityka pieniężna, operacje bankowe
          </div>
          <div>
            <span className="inline-block w-3 h-3 rounded-full bg-purple-500 mr-2" />
            <strong className="text-slate-300">Wykład 6 (cz. 4):</strong>{" "}
            Ubezpieczenia, fundusze inwestycyjne i emerytalne, wspólne
            inwestowanie
          </div>
          <div>
            <span className="inline-block w-3 h-3 rounded-full bg-amber-500 mr-2" />
            <strong className="text-slate-300">Wykład 8:</strong>{" "}
            Publiczny system finansowy, budżet, fundusze celowe, podatki,
            sektor finansów publicznych
          </div>
          <div>
            <span className="inline-block w-3 h-3 rounded-full bg-rose-500 mr-2" />
            <strong className="text-slate-300">Wykład 9:</strong> Finanse a
            ryzyko, koncepcje ryzyka, ryzyko rynkowe/kredytowe, zarządzanie
            ryzykiem, metody kontroli
          </div>
        </div>
      </div>
    </div>
  );
}

function QuizView({
  question,
  currentIndex,
  total,
  selectedAnswer,
  showExplanation,
  onSelectAnswer,
  onNext,
  onQuit,
  score,
}: {
  question: Question;
  currentIndex: number;
  total: number;
  selectedAnswer: number | null;
  showExplanation: boolean;
  onSelectAnswer: (i: number) => void;
  onNext: () => void;
  onQuit: () => void;
  score: number;
}) {
  const progress = ((currentIndex + 1) / total) * 100;
  const topicColor =
    TOPIC_COLORS[question.topic as Topic] || "bg-slate-500";

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <button
          onClick={onQuit}
          className="text-slate-400 hover:text-white text-sm transition-colors"
        >
          &#x2190; Wyjdź
        </button>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-400">
            Wynik: {score}/{currentIndex + (selectedAnswer !== null ? 1 : 0)}
          </span>
          <span className="text-sm text-slate-400">
            {currentIndex + 1} / {total}
          </span>
        </div>
      </div>

      <div className="w-full bg-slate-700/50 rounded-full h-2">
        <div
          className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="bg-slate-800/50 rounded-2xl p-6 border border-slate-700/50">
        <div className="flex items-center gap-2 mb-4">
          <span
            className={`inline-block w-2.5 h-2.5 rounded-full ${topicColor}`}
          />
          <span className="text-xs text-slate-400 uppercase tracking-wide">
            {question.topic}
          </span>
        </div>
        <h2 className="text-xl font-semibold leading-relaxed">
          {question.question}
        </h2>
      </div>

      <div className="space-y-3">
        {question.options.map((option, i) => {
          let style =
            "bg-slate-800/30 border-slate-700/50 hover:bg-slate-700/50 hover:border-slate-600";
          if (selectedAnswer !== null) {
            if (i === question.correctIndex) {
              style =
                "bg-emerald-900/30 border-emerald-500/50 text-emerald-200";
            } else if (i === selectedAnswer && i !== question.correctIndex) {
              style = "bg-red-900/30 border-red-500/50 text-red-200";
            } else {
              style =
                "bg-slate-800/20 border-slate-700/30 opacity-50";
            }
          }

          const letter = String.fromCharCode(65 + i);

          return (
            <button
              key={i}
              onClick={() => onSelectAnswer(i)}
              disabled={selectedAnswer !== null}
              className={`w-full text-left px-5 py-4 rounded-xl border transition-all flex items-start gap-3 ${style}`}
            >
              <span className="font-bold text-sm mt-0.5 shrink-0 w-6">
                {letter}.
              </span>
              <span>{option}</span>
              {selectedAnswer !== null && i === question.correctIndex && (
                <span className="ml-auto shrink-0 text-emerald-400">
                  &#10003;
                </span>
              )}
              {selectedAnswer === i && i !== question.correctIndex && (
                <span className="ml-auto shrink-0 text-red-400">&#10007;</span>
              )}
            </button>
          );
        })}
      </div>

      {showExplanation && (
        <div className="bg-blue-900/20 border border-blue-500/30 rounded-2xl p-5 animate-in slide-in-from-bottom-4 duration-300">
          <h3 className="font-semibold text-blue-300 mb-2 flex items-center gap-2">
            <span>&#x1F4A1;</span> Wyjaśnienie
          </h3>
          <p className="text-slate-300 leading-relaxed">
            {question.explanation}
          </p>
        </div>
      )}

      {selectedAnswer !== null && (
        <button
          onClick={onNext}
          className="w-full bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 py-4 rounded-xl font-semibold transition-all text-lg"
        >
          {currentIndex < total - 1 ? "Następne pytanie →" : "Zobacz wyniki →"}
        </button>
      )}
    </div>
  );
}

function FlashcardView({
  card,
  currentIndex,
  total,
  flipped,
  onFlip,
  onNext,
  onPrev,
  onQuit,
}: {
  card: Flashcard;
  currentIndex: number;
  total: number;
  flipped: boolean;
  onFlip: () => void;
  onNext: () => void;
  onPrev: () => void;
  onQuit: () => void;
}) {
  const topicColor = TOPIC_COLORS[card.topic as Topic] || "bg-slate-500";

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex items-center justify-between">
        <button
          onClick={onQuit}
          className="text-slate-400 hover:text-white text-sm transition-colors"
        >
          &#x2190; Wyjdź
        </button>
        <span className="text-sm text-slate-400">
          {currentIndex + 1} / {total}
        </span>
      </div>

      <div className="w-full bg-slate-700/50 rounded-full h-2">
        <div
          className="bg-gradient-to-r from-purple-500 to-pink-500 h-2 rounded-full transition-all duration-500"
          style={{ width: `${((currentIndex + 1) / total) * 100}%` }}
        />
      </div>

      <button
        onClick={onFlip}
        className="w-full min-h-[320px] perspective-1000"
      >
        <div
          className={`relative w-full min-h-[320px] transition-transform duration-500 transform-style-3d ${
            flipped ? "rotate-y-180" : ""
          }`}
          style={{
            transformStyle: "preserve-3d",
            transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
          }}
        >
          <div
            className="absolute inset-0 bg-gradient-to-br from-slate-800 to-slate-800/80 rounded-2xl p-8 border border-slate-700/50 flex flex-col items-center justify-center text-center"
            style={{ backfaceVisibility: "hidden" }}
          >
            <div className="flex items-center gap-2 mb-6">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${topicColor}`}
              />
              <span className="text-xs text-slate-400 uppercase tracking-wide">
                {card.topic}
              </span>
            </div>
            <h2 className="text-2xl font-bold leading-relaxed">{card.front}</h2>
            <p className="text-slate-500 text-sm mt-6">
              Kliknij, aby odwrócić
            </p>
          </div>
          <div
            className="absolute inset-0 bg-gradient-to-br from-slate-700 to-slate-800 rounded-2xl p-8 border border-slate-600/50 flex flex-col items-center justify-center"
            style={{
              backfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
            }}
          >
            <div className="flex items-center gap-2 mb-6">
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${topicColor}`}
              />
              <span className="text-xs text-slate-400 uppercase tracking-wide">
                {card.topic}
              </span>
            </div>
            <div className="text-lg leading-relaxed whitespace-pre-line text-left w-full">
              {card.back}
            </div>
          </div>
        </div>
      </button>

      <div className="flex gap-3">
        <button
          onClick={onPrev}
          className="flex-1 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 py-4 rounded-xl font-medium transition-all"
        >
          &#x2190; Poprzednia
        </button>
        <button
          onClick={onNext}
          className="flex-1 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 py-4 rounded-xl font-medium transition-all"
        >
          Następna &#x2192;
        </button>
      </div>
    </div>
  );
}

function ResultsView({
  score,
  total,
  percent,
  onReview,
  onRetry,
  onMenu,
}: {
  score: number;
  total: number;
  percent: number;
  onReview: () => void;
  onRetry: () => void;
  onMenu: () => void;
}) {
  const emoji = percent >= 80 ? "&#x1F389;" : percent >= 50 ? "&#x1F4AA;" : "&#x1F4DA;";
  const message =
    percent >= 80
      ? "Świetna robota! Jesteś dobrze przygotowany/a!"
      : percent >= 50
        ? "Nieźle! Powtórz jeszcze słabsze tematy."
        : "Warto jeszcze poćwiczyć. Przejrzyj fiszki i spróbuj ponownie!";

  const gradeColor =
    percent >= 80
      ? "from-emerald-400 to-emerald-600"
      : percent >= 50
        ? "from-amber-400 to-amber-600"
        : "from-red-400 to-red-600";

  return (
    <div className="space-y-8 animate-in fade-in duration-500 text-center">
      <div
        className="text-6xl"
        dangerouslySetInnerHTML={{ __html: emoji }}
      />
      <div>
        <div
          className={`text-7xl font-black bg-gradient-to-b ${gradeColor} bg-clip-text text-transparent`}
        >
          {percent}%
        </div>
        <p className="text-xl text-slate-300 mt-2">
          {score} z {total} poprawnych odpowiedzi
        </p>
      </div>

      <p className="text-lg text-slate-400 max-w-md mx-auto">{message}</p>

      <div className="flex flex-col gap-3 max-w-sm mx-auto">
        <button
          onClick={onReview}
          className="bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 py-4 rounded-xl font-medium transition-all"
        >
          Przejrzyj odpowiedzi
        </button>
        <button
          onClick={onRetry}
          className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-500 hover:to-blue-600 py-4 rounded-xl font-semibold transition-all"
        >
          Spróbuj ponownie
        </button>
        <button
          onClick={onMenu}
          className="text-slate-400 hover:text-white py-3 transition-colors text-sm"
        >
          Powrót do menu
        </button>
      </div>
    </div>
  );
}

function ReviewView({
  questions: qs,
  answers,
  onMenu,
  onRetry,
}: {
  questions: Question[];
  answers: (number | null)[];
  onMenu: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Przegląd odpowiedzi</h2>
        <div className="flex gap-2">
          <button
            onClick={onRetry}
            className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Powtórz quiz
          </button>
          <button
            onClick={onMenu}
            className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Menu
          </button>
        </div>
      </div>

      {qs.map((q, idx) => {
        const userAnswer = answers[idx];
        const isCorrect = userAnswer === q.correctIndex;
        const topicColor =
          TOPIC_COLORS[q.topic as Topic] || "bg-slate-500";

        return (
          <div
            key={q.id}
            className={`bg-slate-800/50 rounded-2xl p-6 border ${
              isCorrect ? "border-emerald-500/30" : "border-red-500/30"
            }`}
          >
            <div className="flex items-center gap-3 mb-3">
              <span
                className={`text-sm font-bold px-2.5 py-1 rounded-lg ${
                  isCorrect
                    ? "bg-emerald-900/50 text-emerald-400"
                    : "bg-red-900/50 text-red-400"
                }`}
              >
                {idx + 1}. {isCorrect ? "Dobrze" : "Źle"}
              </span>
              <div className="flex items-center gap-1.5">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${topicColor}`}
                />
                <span className="text-xs text-slate-500">{q.topic}</span>
              </div>
            </div>

            <h3 className="font-semibold mb-3">{q.question}</h3>

            <div className="space-y-1.5 mb-4">
              {q.options.map((opt, i) => {
                let cls = "text-slate-500 text-sm";
                if (i === q.correctIndex)
                  cls = "text-emerald-400 font-medium text-sm";
                else if (i === userAnswer && i !== q.correctIndex)
                  cls = "text-red-400 line-through text-sm";

                const letter = String.fromCharCode(65 + i);
                return (
                  <div key={i} className={cls}>
                    {letter}. {opt}
                    {i === q.correctIndex && " ✓"}
                    {i === userAnswer && i !== q.correctIndex && " ✗"}
                  </div>
                );
              })}
            </div>

            <div className="text-sm text-slate-400 bg-slate-700/30 rounded-lg p-3">
              {q.explanation}
            </div>
          </div>
        );
      })}
    </div>
  );
}
