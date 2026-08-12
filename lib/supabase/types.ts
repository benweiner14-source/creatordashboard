export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; email: string; display_name: string | null; niche: string | null; created_at: string };
        Insert: { id: string; email: string; display_name?: string | null; niche?: string | null; created_at?: string };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
      };
      diagnostics: {
        Row: {
          id: string;
          profile_id: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          input_url: string;
          status: 'pending' | 'complete' | 'failed';
          hook_strength_score: number | null;
          retention_risk_score: number | null;
          timing_score: number | null;
          format_fit_score: number | null;
          overall_score: number | null;
          report_json: unknown | null;
          error_message: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          platform: 'youtube' | 'tiktok' | 'instagram';
          input_url: string;
          status?: 'pending' | 'complete' | 'failed';
          hook_strength_score?: number | null;
          retention_risk_score?: number | null;
          timing_score?: number | null;
          format_fit_score?: number | null;
          overall_score?: number | null;
          report_json?: unknown | null;
          error_message?: string | null;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['diagnostics']['Insert']>;
      };
      rate_limit_events: {
        Row: { id: string; profile_id: string | null; ip_hash: string; event_type: string; created_at: string };
        Insert: { id?: string; profile_id?: string | null; ip_hash: string; event_type: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['rate_limit_events']['Insert']>;
      };
      glossary_terms: {
        Row: { id: string; slug: string; term: string; definition: string; example: string; created_at: string };
        Insert: { id?: string; slug: string; term: string; definition: string; example: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['glossary_terms']['Insert']>;
      };
      weekly_digests: {
        Row: { id: string; profile_id: string; week_start: string; content_ideas: unknown | null; sent_at: string | null; created_at: string };
        Insert: { id?: string; profile_id: string; week_start: string; content_ideas?: unknown | null; sent_at?: string | null; created_at?: string };
        Update: Partial<Database['public']['Tables']['weekly_digests']['Insert']>;
      };
      niche_community_sources: {
        Row: { id: string; niche: string; source_type: string; source_identifier: string; last_scraped_at: string | null; created_at: string };
        Insert: { id?: string; niche: string; source_type: string; source_identifier: string; last_scraped_at?: string | null; created_at?: string };
        Update: Partial<Database['public']['Tables']['niche_community_sources']['Insert']>;
      };
    };
  };
}
