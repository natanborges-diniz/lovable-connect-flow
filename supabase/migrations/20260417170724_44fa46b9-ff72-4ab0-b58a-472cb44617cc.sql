UPDATE auth.users 
SET encrypted_password = crypt('Test123456!', gen_salt('bf')),
    updated_at = now()
WHERE email = 'marilene@teste';