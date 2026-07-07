import { useMensagensInternas } from "@/hooks/useMensagensInternas";
import { useNotificacoes } from "@/hooks/useNotificacoes";

/**
 * Soma unificada de itens "não vistos" pelo usuário:
 * - Mensagens internas não lidas (1a1 + grupos)
 * - Notificações não lidas (inclui demandas de loja, pois demanda nova gera notificação)
 *
 * Usado pelo TabBadgeManager para pintar o título da aba e o app badge.
 */
export function useUnreadTotal() {
  const { totalNaoLidas } = useMensagensInternas();
  const { naoLidas: notificacoesNaoLidas } = useNotificacoes();

  const mensagens = totalNaoLidas.data ?? 0;
  const notificacoes = notificacoesNaoLidas ?? 0;
  const total = mensagens + notificacoes;

  return {
    total,
    porFonte: { mensagens, notificacoes },
  };
}
