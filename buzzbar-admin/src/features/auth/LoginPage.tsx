import { useEffect } from 'react';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from './auth.store.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { Label } from '../../components/ui/label.js';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const status = useAuthStore((s) => s.status);

  useEffect(() => {
    if (status === 'authenticated') navigate('/dashboard', { replace: true });
  }, [status, navigate]);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' }
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const res = await login(values);
    if (!res.ok) {
      toast.error(res.message, { description: res.errorCode ? `Error: ${res.errorCode}` : undefined });
      return;
    }
    navigate('/dashboard', { replace: true });
  });

  const isBusy = status === 'bootstrapping' || form.formState.isSubmitting;

  return (
    <div className="min-h-screen bg-background">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-24 left-1/2 h-96 w-[48rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,hsl(var(--primary)/0.22),transparent_60%)] blur-2xl" />
        <div className="absolute -bottom-24 right-[-10rem] h-80 w-80 rounded-full bg-[radial-gradient(circle_at_center,hsl(222_35%_45%/0.12),transparent_60%)] blur-2xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-md items-center px-6">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>BuzzBar Admin</CardTitle>
            <CardDescription>Sign in to operate the platform.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={onSubmit}>
              <div className="grid gap-2">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" disabled={isBusy} {...form.register('email')} />
                {form.formState.errors.email?.message ? (
                  <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
                ) : null}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" autoComplete="current-password" disabled={isBusy} {...form.register('password')} />
                {form.formState.errors.password?.message ? (
                  <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
                ) : null}
              </div>

              <Button type="submit" className="mt-2" disabled={isBusy}>
                {isBusy ? 'Signing in…' : 'Sign In'}
              </Button>

              <p className="text-xs text-muted-foreground">
                This is an internal tool. Actions are audited and RBAC is enforced.
              </p>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
