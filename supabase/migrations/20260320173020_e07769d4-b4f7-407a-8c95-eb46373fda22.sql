
-- canais: identificar provedor e status
ALTER TABLE canais ADD COLUMN IF NOT EXISTS provedor text DEFAULT 'meta_official';
ALTER TABLE canais ADD COLUMN IF NOT EXISTS ativo boolean DEFAULT true;

-- atendimentos: saber por qual provedor a conversa acontece
ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS canal_provedor text DEFAULT 'meta_official';

-- mensagens: rastrear provedor por mensagem
ALTER TABLE mensagens ADD COLUMN IF NOT EXISTS provedor text;
