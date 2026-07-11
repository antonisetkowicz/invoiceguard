"""Bayesowska optymalizacja hiperparametrow (Gaussian Process + EI).

Bez zewnetrznych frameworkow: sklearn GaussianProcessRegressor +
akwizycja Expected Improvement. Pierwsze `n_initial` probek losowych,
potem kandydaci wybierani po maksimum EI.

Przyklad:
    >>> from trading_bot.backtest.optimization import BayesianOptimizer
    >>> opt = BayesianOptimizer({"x": (0.0, 10.0)}, seed=1)
    >>> best = opt.optimize(lambda p: -(p["x"] - 3.0) ** 2, n_iter=25)
    >>> abs(best.params["x"] - 3.0) < 1.0
    True
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

import numpy as np
from loguru import logger
from scipy.stats import norm
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import RBF, ConstantKernel, WhiteKernel

#: przestrzen: nazwa parametru -> (min, max); wartosci ciagle
SearchSpace = dict[str, tuple[float, float]]
Objective = Callable[[dict[str, float]], float]


@dataclass(slots=True)
class OptimizationResult:
    params: dict[str, float]
    score: float
    history: list[tuple[dict[str, float], float]] = field(default_factory=list)


class BayesianOptimizer:
    """Maksymalizuje funkcje celu (np. Sharpe z walk-forward)."""

    def __init__(self, space: SearchSpace, n_initial: int = 8, seed: int | None = 42) -> None:
        if not space:
            raise ValueError("Pusta przestrzen poszukiwan")
        self.space = space
        self.n_initial = n_initial
        self._rng = np.random.default_rng(seed)
        self._names = list(space.keys())
        self._bounds = np.array([space[k] for k in self._names], dtype=float)

    # ------------------------------------------------------------- sampling
    def _sample(self, n: int) -> np.ndarray:
        lo, hi = self._bounds[:, 0], self._bounds[:, 1]
        return self._rng.uniform(lo, hi, size=(n, len(self._names)))

    def _to_params(self, x: np.ndarray) -> dict[str, float]:
        return {name: float(v) for name, v in zip(self._names, x)}

    # ------------------------------------------------------------ acquisition
    @staticmethod
    def _expected_improvement(
        mu: np.ndarray, sigma: np.ndarray, best: float, xi: float = 0.01
    ) -> np.ndarray:
        sigma = np.maximum(sigma, 1e-9)
        improvement = mu - best - xi
        z = improvement / sigma
        return improvement * norm.cdf(z) + sigma * norm.pdf(z)

    # -------------------------------------------------------------- optimize
    def optimize(self, objective: Objective, n_iter: int = 30) -> OptimizationResult:
        """Petla: probkuj -> oceniaj -> aktualizuj GP -> wybierz max EI."""
        X: list[np.ndarray] = []
        y: list[float] = []
        history: list[tuple[dict[str, float], float]] = []

        for x in self._sample(min(self.n_initial, n_iter)):
            params = self._to_params(x)
            score = objective(params)
            X.append(x)
            y.append(score)
            history.append((params, score))
            logger.debug("Init sample {} -> {:.4f}", params, score)

        kernel = ConstantKernel(1.0) * RBF(length_scale=np.ones(len(self._names))) + WhiteKernel(1e-4)
        gp = GaussianProcessRegressor(kernel=kernel, normalize_y=True, random_state=0)

        for iteration in range(len(X), n_iter):
            gp.fit(np.array(X), np.array(y))
            candidates = self._sample(256)
            mu, sigma = gp.predict(candidates, return_std=True)
            ei = self._expected_improvement(mu, sigma, best=max(y))
            x_next = candidates[int(np.argmax(ei))]
            params = self._to_params(x_next)
            score = objective(params)
            X.append(x_next)
            y.append(score)
            history.append((params, score))
            logger.debug("Iter {} {} -> {:.4f}", iteration, params, score)

        best_idx = int(np.argmax(y))
        result = OptimizationResult(
            params=self._to_params(X[best_idx]), score=float(y[best_idx]), history=history
        )
        logger.info("Optymalizacja zakonczona: best={:.4f} params={}", result.score, result.params)
        return result


def random_search(space: SearchSpace, objective: Objective, n_iter: int = 50,
                  seed: int | None = 42) -> OptimizationResult:
    """Prosty random search - baseline i fallback dla malych budzetow."""
    opt = BayesianOptimizer(space, n_initial=n_iter, seed=seed)
    xs = opt._sample(n_iter)
    history = []
    for x in xs:
        params = opt._to_params(x)
        history.append((params, objective(params)))
    best_params, best_score = max(history, key=lambda h: h[1])
    return OptimizationResult(params=best_params, score=best_score, history=history)
