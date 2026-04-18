
Usuário está num atendimento em modo humano (replay confirma: badge "👤 Humano" + botão "Devolver para IA" presentes), mas o botão "Solicitar à loja" do `DemandaLojaPanel` não aparece. Preciso entender por que o painel não renderiza.

## Investigação

Vou ler `DemandaLojaPanel.tsx` e como ele é montado no dialog de atendimento (provavelmente em `Atendimentos.tsx` ou um `AtendimentoDialog`).
