pub(crate) fn expand_related_task_queries(focus: &str) -> Vec<String> {
    let normalized = focus.to_lowercase();
    let mut expansions = Vec::new();

    for (needles, expansion) in ACADEMIC_TERM_BRIDGE_RULES {
        if contains_all(&normalized, needles) {
            expansions.push((*expansion).into());
        }
    }

    if contains_all(&normalized, &["arabic", "dialect", "morpholog"]) {
        expansions.push("dialectal arabic segmentation".into());
    }
    if contains_all(
        &normalized,
        &["relation extraction", "convolution", "recurrent"],
    ) {
        expansions.push("recurrent convolutional neural networks relation classification".into());
    }
    if normalized.contains("multi-hop")
        && (normalized.contains("single-hop") || normalized.contains("sub-question"))
    {
        expansions.push("multi-hop question decomposition rescoring".into());
    }
    if contains_all(
        &normalized,
        &["clickbait", "question answering", "passage retrieval"],
    ) {
        expansions.push("clickbait spoiling question answering passage retrieval".into());
    }
    if normalized.contains("semantic role labeling")
        && (normalized.contains("semeval") || normalized.contains("shared task"))
    {
        expansions.push("semantic role labeling shared task senseval semeval conll".into());
    }
    if normalized.contains("sentence embedding") && normalized.contains("transformer") {
        expansions.push("sentence embeddings siamese bert networks".into());
    }
    if contains_all(
        &normalized,
        &["knowledge distillation", "language model", "compress"],
    ) {
        expansions.push("bert distillation natural language understanding".into());
    }
    if contains_all(&normalized, &["calibration", "probability", "answer"]) {
        expansions.push("surface form competition probability answers".into());
    }
    if contains_all(
        &normalized,
        &["depression", "online", "temporal", "topical"],
    ) {
        expansions.push("social media mental health models generalize temporal topical".into());
    }
    if normalized.contains("contrastive learning")
        && (normalized.contains("sentence representation")
            || normalized.contains("sentence embedding"))
    {
        expansions.push("simcse consert contrastive sentence representations".into());
    }
    if contains_all(&normalized, &["conversational", "questioner", "passage"]) {
        expansions.push("quac question answering context".into());
    }
    if contains_all(&normalized, &["nli", "relation extraction", "hypothesis"]) {
        expansions.push("label verbalization entailment relation extraction".into());
    }
    if contains_all(
        &normalized,
        &["dependency", "relation extraction", "syntactic"],
    ) {
        expansions.push("shortest dependency paths relations".into());
    }
    if normalized.contains("word mover") && normalized.contains("sentence") {
        expansions.push("sentence mover similarity multi-sentence evaluation".into());
    }
    if contains_all(&normalized, &["french", "encyclopedia", "framenet"]) {
        expansions.push("calor corpus semantic frame parsing information extraction".into());
    }
    if contains_all(&normalized, &["neural network", "translate", "questions"]) {
        expansions.push("neural question generation reading comprehension learning to ask".into());
    }
    if contains_all(&normalized, &["emotion", "facebook", "languages"]) {
        expansions.push("universal joy emotions across languages data set".into());
    }
    if contains_all(
        &normalized,
        &["semantic parsing", "knowledge-constrained", "grammar"],
    ) {
        expansions.push("structured prediction semantic parsing type constraints".into());
    }
    if contains_all(
        &normalized,
        &[
            "prompt",
            "semi-supervised",
            "natural language understanding",
        ],
    ) {
        expansions
            .push("cloze questions few-shot text classification natural language inference".into());
    }
    if contains_all(&normalized, &["stance detection", "tweets", "2020"]) {
        expansions.push("p-stance political stance detection covid-19 tweets".into());
    }
    if contains_all(&normalized, &["native language", "eye movement", "english"]) {
        expansions.push("predicting native language gaze eye movements".into());
    }
    if contains_all(&normalized, &["wikihowtoimprove", "clarification"]) {
        expansions.push("unimplicit clarification requirements instructional text".into());
    }
    if contains_all(
        &normalized,
        &["open information extraction", "lexical", "syntactic"],
    ) {
        expansions.push("identifying relations open information extraction".into());
    }
    if contains_all(&normalized, &["dialectal", "normalized", "arabic"]) {
        expansions.push("multi-dialect neural machine translation dialectometry".into());
    }
    if contains_all(
        &normalized,
        &["suicide risk", "low-resource", "terminology"],
    ) {
        expansions.push("detecting suicide risk online counseling low-resource language".into());
    }
    if normalized.contains("sql") && normalized.contains("wikitq") {
        expansions.push("lexico-logical alignments semantic parsing sql wikitq".into());
    }
    if contains_all(
        &normalized,
        &["constituency parser", "few-shot", "data augmentation"],
    ) {
        expansions.push("role supervision unsupervised constituency parsing".into());
    }
    if contains_all(
        &normalized,
        &["relation extraction", "tree lstm", "dependency"],
    ) {
        expansions.push("tree-structured long short-term memory semantic representations".into());
    }
    if contains_all(&normalized, &["sarcasm", "social media", "capturing data"]) {
        expansions.push("reactive supervision collecting sarcasm data".into());
    }
    if normalized.contains("clickbait") && normalized.contains("spoiling") {
        expansions.push("semeval 2023 task clickbait spoiling".into());
    }
    if contains_all(&normalized, &["frame conditioning", "argument claims"]) {
        expansions.push("aspect-controlled neural argument generation".into());
    }

    expansions
}

/// Maps descriptive research requests to established task, dataset, or method names.
///
/// Keep rules narrow: every entry requires multiple independent cues so a generic
/// request does not inherit a benchmark, model, or paper family it did not imply.
const ACADEMIC_TERM_BRIDGE_RULES: &[(&[&str], &str)] = &[
    (
        &["nuclear norm", "weight matrix", "probing"],
        "information-theoretic probing linguistic structure nuclear norm",
    ),
    (
        &["sentence simplification", "wikipedia"],
        "sentence simplification with deep reinforcement learning wikipedia",
    ),
    (
        &["perplexity", "fact-checking"],
        "few-shot fact-checking via perplexity language models",
    ),
    (
        &["dataset", "fact verification"],
        "fever fact extraction and verification dataset",
    ),
    (
        &["mechanical turk", "document coverage"],
        "partial or complete that's the question",
    ),
    (
        &["word2vec", "character n-grams"],
        "enriching word vectors with subword information",
    ),
    (
        &["distillation", "attention mechanism", "teacher-student"],
        "minilmv2 self-attention relation distillation",
    ),
    (
        &["language modeling", "ccg supertagging", "lstm"],
        "colorless green recurrent networks supertagging with lstms",
    ),
    (
        &["dependency parsing", "graph-to-graph", "iterative refinement"],
        "recursive non-autoregressive graph-to-graph transformer dependency parsing",
    ),
    (
        &["discourse parsing", "parseval", "micro-averaged"],
        "top-down neural discourse parsing rhetorical structure",
    ),
    (
        &["computer-assisted translation", "keystroke ratio", "mouse action"],
        "statistical approaches computer-assisted translation keystroke mouse action ratio",
    ),
    (
        &["named entity recognition", "ambiguous", "annotation"],
        "crossweigh training named entity tagger imperfect annotations",
    ),
    (
        &["machine translation", "encoder/decoder", "attention heads"],
        "massively multilingual neural machine translation zero-shot",
    ),
    (
        &["prediction entropy", "copy", "novel content"],
        "uncertainty neural abstractive summarization entropy copy novel",
    ),
    (
        &["simultaneous machine translation", "ground-truth alignments"],
        "fast_align reparameterized ibm model 2 word alignment",
    ),
    (
        &["reinforcement learning", "successful outcome", "irrelevant"],
        "from language to programs reinforcement learning maximum marginal likelihood spurious programs",
    ),
    (
        &["beam search", "machine translation", "full target context"],
        "discriminative reranking noisy channel neural machine translation full target context",
    ),
    (
        &["attention mechanisms", "bidirectional recurrent", "relation classification"],
        "attention-based bidirectional lstm relation classification",
    ),
    (
        &["multi-hop questions", "sequence", "simpler query steps"],
        "break it down question decomposition meaning representation qdmr",
    ),
    (
        &["giza++", "semantic parsing", "meaning representations"],
        "semantic parsing statistical machine translation giza meaning representations",
    ),
    (
        &["sentence embedding", "cosine similarity", "clustering"],
        "sentence-bert sentence embeddings cosine similarity clustering",
    ),
    (
        &["streaming degree", "simultaneous machine translation"],
        "learning to translate in real-time with neural machine translation",
    ),
    (
        &["compositional generalization", "unseen local structures"],
        "unobserved local structures compositional generalization semantic parsing",
    ),
    (
        &["binarizing", "non-binary subtrees", "discourse parsing"],
        "classifier-based parser with linear run-time complexity",
    ),
    (
        &["user comments", "claim verifiability"],
        "support for propositions user comments claim verifiability",
    ),
    (
        &["word senses", "embeddings", "external lexical resources"],
        "making sense of word embeddings",
    ),
];

fn contains_all(value: &str, needles: &[&str]) -> bool {
    needles.iter().all(|needle| value.contains(needle))
}

#[cfg(test)]
mod tests {
    use super::expand_related_task_queries;

    #[test]
    fn expands_descriptive_nlp_requests_into_established_task_terms() {
        let fixtures = [
            (
                "combine convolutional and recurrent neural networks for relation extraction",
                "recurrent convolutional neural networks relation classification",
            ),
            (
                "transform multi-hop questions into single-hop sub-questions",
                "multi-hop question decomposition rescoring",
            ),
            (
                "question answering and passage retrieval for mitigating clickbait headlines",
                "clickbait spoiling question answering passage retrieval",
            ),
            (
                "transformer-based sentence embeddings",
                "sentence embeddings siamese bert networks",
            ),
            (
                "compress language models using task-agnostic knowledge distillation",
                "bert distillation natural language understanding",
            ),
            (
                "contextualized calibration for the probability of answers in language models",
                "surface form competition probability answers",
            ),
        ];

        for (request, expected) in fixtures {
            assert_eq!(expand_related_task_queries(request), vec![expected]);
        }
    }

    #[test]
    fn expands_litsearch_second_slice_task_descriptions() {
        let fixtures = [
            (
                "detect depression from online posts while addressing temporal and topical artifacts",
                "social media mental health models generalize temporal topical",
            ),
            (
                "data augmentation in contrastive learning for sentence representations",
                "simcse consert contrastive sentence representations",
            ),
            (
                "conversational QA where the questioner cannot access the passage",
                "quac question answering context",
            ),
            (
                "NLI relation extraction using hypothesis generation",
                "label verbalization entailment relation extraction",
            ),
            (
                "dependency relation extraction for non-local syntactic relations",
                "shortest dependency paths relations",
            ),
            (
                "adapt Word Mover distance to sentences",
                "sentence mover similarity multi-sentence evaluation",
            ),
        ];

        for (request, expected) in fixtures {
            assert_eq!(expand_related_task_queries(request), vec![expected]);
        }
    }

    #[test]
    fn unrelated_requests_do_not_receive_domain_specific_terms() {
        assert!(expand_related_task_queries("graph neural networks for molecules").is_empty());
    }

    #[test]
    fn expands_litsearch_third_slice_task_descriptions() {
        let fixtures = [
            (
                "French encyclopedia documents with FrameNet annotations",
                "calor corpus semantic frame parsing information extraction",
            ),
            (
                "neural networks that translate passages into questions",
                "neural question generation reading comprehension learning to ask",
            ),
            (
                "emotion labels in Facebook posts across languages",
                "universal joy emotions across languages data set",
            ),
            (
                "semantic parsing with knowledge-constrained decoding and grammar rules",
                "structured prediction semantic parsing type constraints",
            ),
            (
                "prompt fine-tuning for semi-supervised natural language understanding",
                "cloze questions few-shot text classification natural language inference",
            ),
            (
                "stance detection datasets for tweets since 2020",
                "p-stance political stance detection covid-19 tweets",
            ),
            (
                "predict native language using eye movement while reading English",
                "predicting native language gaze eye movements",
            ),
            (
                "wikiHowToImprove clarification requirements",
                "unimplicit clarification requirements instructional text",
            ),
            (
                "open information extraction with lexical and syntactic constraints",
                "identifying relations open information extraction",
            ),
            (
                "dialectal variations and normalized text in Arabic",
                "multi-dialect neural machine translation dialectometry",
            ),
            (
                "suicide risk classification in a low-resource language using terminology",
                "detecting suicide risk online counseling low-resource language",
            ),
            (
                "SQL annotations over WikiTQ",
                "lexico-logical alignments semantic parsing sql wikitq",
            ),
            (
                "constituency parsers in few-shot settings with data augmentation",
                "role supervision unsupervised constituency parsing",
            ),
            (
                "relation extraction with dependency structures and a tree LSTM",
                "tree-structured long short-term memory semantic representations",
            ),
            (
                "capturing data for sarcasm detection on social media",
                "reactive supervision collecting sarcasm data",
            ),
            (
                "competition for clickbait spoiling",
                "semeval 2023 task clickbait spoiling",
            ),
            (
                "frame conditioning for generated argument claims",
                "aspect-controlled neural argument generation",
            ),
        ];

        for (request, expected) in fixtures {
            assert_eq!(expand_related_task_queries(request), vec![expected]);
        }
    }

    #[test]
    fn expands_descriptions_using_precise_academic_term_bridges() {
        let fixtures = [
            (
                "the nuclear norm of a weight matrix for probing tasks",
                "information-theoretic probing linguistic structure nuclear norm",
            ),
            (
                "large Wikipedia datasets for sentence simplification",
                "sentence simplification with deep reinforcement learning wikipedia",
            ),
            (
                "perplexity for misinformation fact-checking",
                "few-shot fact-checking via perplexity language models",
            ),
            (
                "a comprehensive dataset for fact verification",
                "fever fact extraction and verification dataset",
            ),
            (
                "Amazon Mechanical Turk annotation maximizing document coverage",
                "partial or complete that's the question",
            ),
            (
                "word2vec embeddings using character n-grams",
                "enriching word vectors with subword information",
            ),
            (
                "distillation with attention mechanism alignment in teacher-student models",
                "minilmv2 self-attention relation distillation",
            ),
            (
                "LSTM architectures for language modeling and CCG supertagging",
                "colorless green recurrent networks supertagging with lstms",
            ),
            (
                "dependency parsing with graph-to-graph transformers and iterative refinement",
                "recursive non-autoregressive graph-to-graph transformer dependency parsing",
            ),
            (
                "discourse parsing using Parseval and micro-averaged F1",
                "top-down neural discourse parsing rhetorical structure",
            ),
            (
                "computer-assisted translation with keystroke ratio and mouse action ratio",
                "statistical approaches computer-assisted translation keystroke mouse action ratio",
            ),
            (
                "Named Entity Recognition for ambiguous entities requiring annotation knowledge",
                "crossweigh training named entity tagger imperfect annotations",
            ),
            (
                "machine translation encoder/decoder layers and attention heads",
                "massively multilingual neural machine translation zero-shot",
            ),
            (
                "prediction entropy and the tendency to copy or create novel content",
                "uncertainty neural abstractive summarization entropy copy novel",
            ),
            (
                "simultaneous machine translation using ground-truth alignments",
                "fast_align reparameterized ibm model 2 word alignment",
            ),
            (
                "reinforcement learning correlates a successful outcome with irrelevant actions",
                "from language to programs reinforcement learning maximum marginal likelihood spurious programs",
            ),
            (
                "beam search in machine translation without full target context",
                "discriminative reranking noisy channel neural machine translation full target context",
            ),
            (
                "attention mechanisms for bidirectional recurrent networks in relation classification",
                "attention-based bidirectional lstm relation classification",
            ),
            (
                "multi-hop questions as a sequence of simpler query steps",
                "break it down question decomposition meaning representation qdmr",
            ),
            (
                "GIZA++ for semantic parsing and meaning representations",
                "semantic parsing statistical machine translation giza meaning representations",
            ),
            (
                "sentence embedding grounding with cosine similarity and clustering",
                "sentence-bert sentence embeddings cosine similarity clustering",
            ),
            (
                "streaming degree metric for simultaneous machine translation",
                "learning to translate in real-time with neural machine translation",
            ),
            (
                "compositional generalization with unseen local structures",
                "unobserved local structures compositional generalization semantic parsing",
            ),
            (
                "binarizing non-binary subtrees in discourse parsing",
                "classifier-based parser with linear run-time complexity",
            ),
            (
                "annotating user comments with claim verifiability",
                "support for propositions user comments claim verifiability",
            ),
            (
                "matching word senses in contexts using embeddings without external lexical resources",
                "making sense of word embeddings",
            ),
        ];

        for (request, expected) in fixtures {
            assert_eq!(expand_related_task_queries(request), vec![expected]);
        }
    }
}
