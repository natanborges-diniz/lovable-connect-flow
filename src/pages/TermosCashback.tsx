import { useSearchParams } from "react-router-dom";

const TERMOS_VERSAO = "v2-2026-07";

export default function TermosCashback() {
  const [sp] = useSearchParams();
  const inscricao = sp.get("ins");

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-10 space-y-6">
        <header className="border-b pb-4">
          <h1 className="text-2xl font-bold">Termos de Uso e Privacidade — Cashback Óticas Diniz</h1>
          <p className="text-xs text-muted-foreground mt-2">
            Versão {TERMOS_VERSAO}
            {inscricao ? ` · Inscrição #${inscricao.slice(0, 8)}` : ""}
          </p>
        </header>

        <section className="space-y-4 text-sm leading-relaxed">
          <h2 className="text-lg font-semibold">1. Aceite</h2>
          <p>
            Ao informar o código (PIN) recebido por WhatsApp ao consultor da loja, você confirma que este
            número de telefone é seu, autoriza a Óticas Diniz a utilizá-lo como canal oficial de
            comunicação para o programa de cashback e aceita estes termos.
          </p>

          <h2 className="text-lg font-semibold">2. Tratamento de dados pessoais (LGPD)</h2>
          <p>
            Coletamos seu nome, CPF, telefone e dados da compra para operacionalizar o cashback,
            cumprir obrigações fiscais e enviar mensagens relacionadas ao programa.
            Você pode solicitar acesso, correção, anonimização ou exclusão a qualquer momento entrando
            em contato com a loja. Base legal: execução de contrato (art. 7º, V, LGPD) e
            consentimento (art. 7º, I).
          </p>

          <h2 className="text-lg font-semibold">3. Comunicações — transacionais e de marketing</h2>
          <p>
            Ao confirmar o PIN você autoriza expressamente a Óticas Diniz a enviar, pelo WhatsApp
            informado, tanto <strong>mensagens transacionais</strong> (aviso de crédito, saldo,
            liberação, vencimento, uso do cashback) quanto <strong>mensagens de marketing</strong>
            do programa (ofertas exclusivas, novos benefícios, lembretes de saldo a expirar e
            campanhas relacionadas). Esse consentimento é livre e pode ser revogado a qualquer
            momento respondendo <strong> SAIR </strong> ao WhatsApp — a revogação não afeta o
            cashback já creditado, apenas encerra o envio de novas mensagens de marketing.
          </p>

          <h2 className="text-lg font-semibold">4. Validade do PIN</h2>
          <p>
            O código tem validade de 15 minutos e até 3 tentativas. Se expirar, peça ao consultor para
            reenviar.
          </p>

          <h2 className="text-lg font-semibold">5. Retenção de registros</h2>
          <p>
            O registro do aceite (data, hora, telefone, versão dos termos e IP do consultor) é
            mantido pelo prazo mínimo de 5 anos, para fins de auditoria e cumprimento de obrigações
            legais (art. 27 CDC, LGPD art. 16, II).
          </p>

          <h2 className="text-lg font-semibold">6. Contato</h2>
          <p>
            Dúvidas: fale com a loja em que foi feita a compra ou com o atendimento oficial da Óticas
            Diniz pelo WhatsApp.
          </p>
        </section>

        <footer className="border-t pt-4 text-xs text-muted-foreground">
          © Óticas Diniz — Programa de Cashback
        </footer>
      </div>
    </div>
  );
}
