import { Link } from 'react-router-dom';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.js';

export function UnauthorizedPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-lg items-center px-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
          <CardDescription>Your role does not have permission to view this page.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Button asChild>
            <Link to="/dashboard">Go to dashboard</Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link to="/login">Sign in again</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

