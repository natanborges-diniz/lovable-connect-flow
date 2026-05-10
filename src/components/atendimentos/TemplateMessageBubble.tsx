import { Send } from "lucide-react";
import { parseTemplateMessage, renderTemplateBody } from "@/lib/whatsapp-template-render";

interface Props {
  conteudo: string;
  templates: Map<string, string> | undefined;
}

/**
 * Renderiza uma mensagem outbound de template já com os {{N}} substituídos,
 * exatamente como o cliente recebeu no WhatsApp. Em caso de parse falho ou
 * template ausente do catálogo, faz fallback para o conteúdo original.
 */
export function TemplateMessageBubble({ conteudo, templates }: Props) {
  const parsed = parseTemplateMessage(conteudo);
  const body = parsed && templates?.get(parsed.name);

  if (!parsed || !body) {
    return <p className="whitespace-pre-wrap break-words">{conteudo}</p>;
  }

  const rendered = renderTemplateBody(body, parsed.params);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide opacity-70">
        <Send className="h-3 w-3" />
        <span>Template • {parsed.name}</span>
      </div>
      <p className="whitespace-pre-wrap break-words">{rendered}</p>
    </div>
  );
}
