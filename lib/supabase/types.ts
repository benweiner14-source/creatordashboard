export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; email: string; display_name: string | null; niche: string | null; created_at: string };
        Insert: { id: string; email: string; display_name?: string | null; niche?: string | null; created_at?: string };
        Update: Partial<Database['public']['Tables']['profiles']['Insert']>;
        Relationships: [];
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
        Relationships: [];
      };
      rate_limit_events: {
        Row: { id: string; profile_id: string | null; ip_hash: string; event_type: string; created_at: string };
        Insert: { id?: string; profile_id?: string | null; ip_hash: string; event_type: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['rate_limit_events']['Insert']>;
        Relationships: [];
      };
      glossary_terms: {
        Row: { id: string; slug: string; term: string; definition: string; example: string; created_at: string };
        Insert: { id?: string; slug: string; term: string; definition: string; example: string; created_at?: string };
        Update: Partial<Database['public']['Tables']['glossary_terms']['Insert']>;
        Relationships: [];
      };
      weekly_digests: {
        Row: { id: string; profile_id: string; week_start: string; content_ideas: unknown | null; sent_at: string | null; created_at: string };
        Insert: { id?: string; profile_id: string; week_start: string; content_ideas?: unknown | null; sent_at?: string | null; created_at?: string };
        Update: Partial<Database['public']['Tables']['weekly_digests']['Insert']>;
        Relationships: [];
      };
      niche_community_sources: {
        Row: { id: string; niche: string; source_type: string; source_identifier: string; last_scraped_at: string | null; created_at: string };
        Insert: { id?: string; niche: string; source_type: string; source_identifier: string; last_scraped_at?: string | null; created_at?: string };
        Update: Partial<Database['public']['Tables']['niche_community_sources']['Insert']>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      check_and_record_rate_limit: {
        Args: {
          p_profile_id: string | null;
          p_identity_hash: string | null;
          p_ip_hash: string;
          p_event_type: string;
          p_profile_limit: number;
          p_ip_limit: number;
          p_window_start: string;
          p_now: string;
        };
        Returns: { allowed: boolean; reason: string | null; event_id: string | null }[];
      };
      release_rate_limit_event: {
        Args: { p_event_id: string };
        Returns: undefined;
      };
    };
  };
}
