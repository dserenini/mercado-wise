// Dinheiro é sempre inteiro em centavos dentro do app: 0.1 + 0.2 !== 0.3 em ponto
// flutuante, mas 10 + 20 === 30. A conversão acontece uma vez, na fronteira.

/** Reais (como lidos da nota) → centavos inteiros. */
export function toCents(reais: number): number {
  return Math.round(reais * 100);
}

/** Centavos → texto em reais para mensagens ("R$ 72,23"). */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const reais = Math.floor(abs / 100).toLocaleString("pt-BR");
  return `${sign}R$ ${reais},${String(abs % 100).padStart(2, "0")}`;
}
