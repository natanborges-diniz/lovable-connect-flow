
INSERT INTO public.configuracoes_ia (chave, valor)
VALUES (
  'pagamento_intent_keywords',
  '["forma de pagamento","formas de pagamento","como pago","como posso pagar","como funciona o pagamento","aceita cartao","aceitam cartao","parcela","parcelar","parcelado","parcelamento","a vista","somente a vista","so a vista","apenas a vista","tem desconto","desconto a vista","pix","boleto","crediario","credito","debito","quantas vezes","em quantas"]'::text
)
ON CONFLICT (chave) DO NOTHING;
