DELETE FROM pricing_table_lentes WHERE brand='Hoya' AND family='Hoyalux D+';

INSERT INTO pricing_table_lentes (brand, family, category, index_name, treatment, blue, photo, sphere_min, sphere_max, cylinder_min, cylinder_max, add_min, add_max, diameter, price_brl, priority, active, source_catalog, source_page) VALUES
-- 1.50
('Hoya','Hoyalux D+','progressive','1.50','BlueControl',  true, false,-8,6,-4,0,0.75,3.50,80,2050.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.50','LongLife',     false,false,-8,6,-4,0,0.75,3.50,80,2050.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.50','NO-Risk+BC',   true, false,-8,6,-4,0,0.75,3.50,80,1840.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.50','NO-Risk',      false,false,-8,6,-4,0,0.75,3.50,80,1797.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.50','CleanExtra',   false,false,-8,6,-4,0,0.75,3.50,80,1400.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.50','Hard',         false,false,-8,6,-4,0,0.75,3.50,80,1047.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
-- Trivex
('Hoya','Hoyalux D+','progressive','Trivex','BlueControl',true, false,-8,6,-4,0,0.75,3.50,80,3078.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','Trivex','LongLife',   false,false,-8,6,-4,0,0.75,3.50,80,3078.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','Trivex','NO-Risk+BC', true, false,-8,6,-4,0,0.75,3.50,80,2262.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','Trivex','NO-Risk',    false,false,-8,6,-4,0,0.75,3.50,80,2262.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','Trivex','CleanExtra', false,false,-8,6,-4,0,0.75,3.50,80,1692.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','Trivex','Hard',       false,false,-8,6,-4,0,0.75,3.50,80,1358.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
-- Poli (sem BlueControl)
('Hoya','Hoyalux D+','progressive','Poli','LongLife',     false,false,-10,6,-4,0,0.75,3.50,80,2562.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','Poli','NO-Risk+BC',   true, false,-10,6,-4,0,0.75,3.50,80,2297.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','Poli','NO-Risk',      false,false,-10,6,-4,0,0.75,3.50,80,2297.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','Poli','CleanExtra',   false,false,-10,6,-4,0,0.75,3.50,80,1877.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','Poli','Hard',         false,false,-10,6,-4,0,0.75,3.50,80,1360.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
-- 1.67
('Hoya','Hoyalux D+','progressive','1.67','BlueControl',  true, false,-13,7.5,-4,0,0.75,3.50,80,3437.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.67','LongLife',     false,false,-13,7.5,-4,0,0.75,3.50,80,3437.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.67','NO-Risk+BC',   true, false,-13,7.5,-4,0,0.75,3.50,80,3207.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.67','NO-Risk',      false,false,-13,7.5,-4,0,0.75,3.50,80,3207.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.67','CleanExtra',   false,false,-13,7.5,-4,0,0.75,3.50,80,2787.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.67','Hard',         false,false,-13,7.5,-4,0,0.75,3.50,80,1990.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
-- 1.50 Sensity (fotossensível)
('Hoya','Hoyalux D+','progressive','1.50 Sensity','BlueControl',  true, true,-8,6,-4,0,0.75,3.50,80,3231.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.50 Sensity','LongLife',     false,true,-8,6,-4,0,0.75,3.50,80,3231.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.50 Sensity','NO-Risk+BC',   true, true,-8,6,-4,0,0.75,3.50,80,3001.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.50 Sensity','NO-Risk',      false,true,-8,6,-4,0,0.75,3.50,80,2840.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.50 Sensity','CleanExtra',   false,true,-8,6,-4,0,0.75,3.50,80,2581.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.50 Sensity','Hard',         false,true,-8,6,-4,0,0.75,3.50,80,2251.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
-- Trivex Sensity (fotossensível)
('Hoya','Hoyalux D+','progressive','Trivex Sensity','BlueControl',true, true,-8,6,-4,0,0.75,3.50,80,4050.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','Trivex Sensity','LongLife',   false,true,-8,6,-4,0,0.75,3.50,80,4050.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','Trivex Sensity','NO-Risk+BC', true, true,-8,6,-4,0,0.75,3.50,80,3552.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','Trivex Sensity','NO-Risk',    false,true,-8,6,-4,0,0.75,3.50,80,3552.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','Trivex Sensity','CleanExtra', false,true,-8,6,-4,0,0.75,3.50,80,3132.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','Trivex Sensity','Hard',       false,true,-8,6,-4,0,0.75,3.50,80,2892.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
-- 1.67 Sensity (fotossensível)
('Hoya','Hoyalux D+','progressive','1.67 Sensity','BlueControl',  true, true,-13,7.5,-4,0,0.75,3.50,80,4595.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.67 Sensity','LongLife',     false,true,-13,7.5,-4,0,0.75,3.50,80,4595.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.67 Sensity','NO-Risk+BC',   true, true,-13,7.5,-4,0,0.75,3.50,80,4365.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.67 Sensity','NO-Risk',      false,true,-13,7.5,-4,0,0.75,3.50,80,4365.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.67 Sensity','CleanExtra',   false,true,-13,7.5,-4,0,0.75,3.50,80,3945.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2'),
('Hoya','Hoyalux D+','progressive','1.67 Sensity','Hard',         false,true,-13,7.5,-4,0,0.75,3.50,80,3363.00,10,true,'Hoya Hoyalux D+ Mai/2026','p2');