export type Middleware = (req: Request) => Promise<Response | null>;

export function withAuth(verifyToken: (token: string) => Promise<boolean>): Middleware {
  return async (req: Request) => {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized', status: 401 }), { status: 401 });
    }
    const token = authHeader.split(' ')[1];
    const isValid = await verifyToken(token);
    if (!isValid) {
      return new Response(JSON.stringify({ error: 'Unauthorized', status: 401 }), { status: 401 });
    }
    return null;
  };
}

export function withCors(allowedOrigin = '*'): Middleware {
  return async (req: Request) => {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': allowedOrigin,
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization'
        }
      });
    }
    return null; // Next middleware/handler should add headers to actual response if needed
  };
}
