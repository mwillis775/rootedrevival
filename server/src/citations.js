/**
 * OpenSource Scholar - Citation Engine
 * 
 * Generates citations in multiple formats (APA, MLA, Chicago, IEEE, BibTeX, RIS, CSL-JSON).
 */

/**
 * Format author names for different citation styles
 */
function formatAuthorsAPA(authors) {
    if (!authors || authors.length === 0) return '';
    
    if (authors.length === 1) {
        return formatAuthorAPA(authors[0]);
    }
    
    if (authors.length === 2) {
        return `${formatAuthorAPA(authors[0])} & ${formatAuthorAPA(authors[1])}`;
    }
    
    if (authors.length <= 20) {
        const formatted = authors.slice(0, -1).map(formatAuthorAPA).join(', ');
        return `${formatted}, & ${formatAuthorAPA(authors[authors.length - 1])}`;
    }
    
    // More than 20 authors: first 19, ..., last
    const first19 = authors.slice(0, 19).map(formatAuthorAPA).join(', ');
    return `${first19}, ... ${formatAuthorAPA(authors[authors.length - 1])}`;
}

function formatAuthorAPA(author) {
    const name = author.author_name || author.name || author;
    if (typeof name !== 'string') return '';
    
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    
    const lastName = parts[parts.length - 1];
    const initials = parts.slice(0, -1).map(p => p[0].toUpperCase() + '.').join(' ');
    
    return `${lastName}, ${initials}`;
}

function formatAuthorsMLA(authors) {
    if (!authors || authors.length === 0) return '';
    
    const getName = (a) => a.author_name || a.name || a;
    
    if (authors.length === 1) {
        return formatAuthorMLA(authors[0]);
    }
    
    if (authors.length === 2) {
        return `${formatAuthorMLA(authors[0])}, and ${getName(authors[1])}`;
    }
    
    return `${formatAuthorMLA(authors[0])}, et al.`;
}

function formatAuthorMLA(author) {
    const name = author.author_name || author.name || author;
    if (typeof name !== 'string') return '';
    
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    
    const lastName = parts[parts.length - 1];
    const firstName = parts.slice(0, -1).join(' ');
    
    return `${lastName}, ${firstName}`;
}

function formatAuthorsChicago(authors) {
    if (!authors || authors.length === 0) return '';
    
    const getName = (a) => a.author_name || a.name || a;
    
    if (authors.length === 1) {
        return formatAuthorChicago(authors[0]);
    }
    
    if (authors.length === 2) {
        return `${formatAuthorChicago(authors[0])} and ${getName(authors[1])}`;
    }
    
    if (authors.length === 3) {
        return `${formatAuthorChicago(authors[0])}, ${getName(authors[1])}, and ${getName(authors[2])}`;
    }
    
    return `${formatAuthorChicago(authors[0])} et al.`;
}

function formatAuthorChicago(author) {
    const name = author.author_name || author.name || author;
    if (typeof name !== 'string') return '';
    
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0];
    
    const lastName = parts[parts.length - 1];
    const firstName = parts.slice(0, -1).join(' ');
    
    return `${lastName}, ${firstName}`;
}

function formatAuthorsIEEE(authors) {
    if (!authors || authors.length === 0) return '';
    
    const formatOne = (a) => {
        const name = a.author_name || a.name || a;
        if (typeof name !== 'string') return '';
        
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) return parts[0];
        
        const lastName = parts[parts.length - 1];
        const initials = parts.slice(0, -1).map(p => p[0].toUpperCase() + '.').join(' ');
        
        return `${initials} ${lastName}`;
    };
    
    if (authors.length === 1) {
        return formatOne(authors[0]);
    }
    
    if (authors.length === 2) {
        return `${formatOne(authors[0])} and ${formatOne(authors[1])}`;
    }
    
    const allButLast = authors.slice(0, -1).map(formatOne).join(', ');
    return `${allButLast}, and ${formatOne(authors[authors.length - 1])}`;
}

/**
 * Generate APA 7th edition citation
 */
function generateAPA(paper) {
    const authors = formatAuthorsAPA(paper.authors);
    const year = paper.publication_year ? `(${paper.publication_year})` : '(n.d.)';
    const title = paper.title;
    
    let citation = `${authors} ${year}. ${title}.`;
    
    if (paper.doi) {
        citation += ` https://doi.org/${paper.doi}`;
    }
    
    return citation;
}

/**
 * Generate MLA 9th edition citation
 */
function generateMLA(paper) {
    const authors = formatAuthorsMLA(paper.authors);
    const title = `"${paper.title}."`;
    const year = paper.publication_year || 'n.d.';
    
    let citation = `${authors}. ${title}`;
    
    citation += ` OpenSource Scholar, ${year}`;
    
    if (paper.doi) {
        citation += `, https://doi.org/${paper.doi}`;
    }
    
    citation += '.';
    
    return citation;
}

/**
 * Generate Chicago 17th edition citation (notes-bibliography)
 */
function generateChicago(paper) {
    const authors = formatAuthorsChicago(paper.authors);
    const title = `"${paper.title}"`;
    const year = paper.publication_year || 'n.d.';
    
    let citation = `${authors}. ${title}. OpenSource Scholar, ${year}.`;
    
    if (paper.doi) {
        citation += ` https://doi.org/${paper.doi}.`;
    }
    
    return citation;
}

/**
 * Generate IEEE citation
 */
function generateIEEE(paper, refNumber = 1) {
    const authors = formatAuthorsIEEE(paper.authors);
    const title = `"${paper.title},"`;
    const year = paper.publication_year || 'n.d.';
    
    let citation = `[${refNumber}] ${authors}, ${title} OpenSource Scholar, ${year}`;
    
    if (paper.doi) {
        citation += `, doi: ${paper.doi}`;
    }
    
    citation += '.';
    
    return citation;
}

/**
 * Generate BibTeX citation
 */
function generateBibTeX(paper) {
    const getName = (a) => a.author_name || a.name || a;
    const authors = paper.authors ? paper.authors.map(getName).join(' and ') : '';
    
    // Generate a citation key
    const firstAuthor = paper.authors?.[0];
    const lastName = firstAuthor 
        ? (getName(firstAuthor).split(/\s+/).pop() || 'unknown').toLowerCase()
        : 'unknown';
    const year = paper.publication_year || 'nd';
    const titleWord = (paper.title.split(/\s+/)[0] || 'paper').toLowerCase().replace(/[^a-z]/g, '');
    const key = `${lastName}${year}${titleWord}`;
    
    let type = '@article';
    if (paper.paper_type === 'book') type = '@book';
    if (paper.paper_type === 'thesis') type = '@phdthesis';
    if (paper.paper_type === 'dataset') type = '@misc';
    
    let bibtex = `${type}{${key},\n`;
    bibtex += `  author = {${authors}},\n`;
    bibtex += `  title = {${paper.title}},\n`;
    bibtex += `  year = {${paper.publication_year || ''}},\n`;
    
    if (paper.doi) {
        bibtex += `  doi = {${paper.doi}},\n`;
    }
    
    if (paper.abstract) {
        bibtex += `  abstract = {${paper.abstract.substring(0, 500)}},\n`;
    }
    
    bibtex += `  publisher = {OpenSource Scholar},\n`;
    bibtex += `  url = {https://opensourcescholar.org/paper/${paper.uuid}}\n`;
    bibtex += '}';
    
    return bibtex;
}

/**
 * Generate RIS (Research Information Systems) format
 */
function generateRIS(paper) {
    const getName = (a) => a.author_name || a.name || a;
    
    let typeCode = 'JOUR';
    if (paper.paper_type === 'book') typeCode = 'BOOK';
    if (paper.paper_type === 'thesis') typeCode = 'THES';
    if (paper.paper_type === 'dataset') typeCode = 'DATA';
    if (paper.paper_type === 'preprint') typeCode = 'UNPB';
    
    let ris = `TY  - ${typeCode}\n`;
    
    if (paper.authors) {
        for (const author of paper.authors) {
            ris += `AU  - ${getName(author)}\n`;
        }
    }
    
    ris += `TI  - ${paper.title}\n`;
    
    if (paper.publication_year) {
        ris += `PY  - ${paper.publication_year}\n`;
    }
    
    if (paper.abstract) {
        ris += `AB  - ${paper.abstract}\n`;
    }
    
    if (paper.doi) {
        ris += `DO  - ${paper.doi}\n`;
    }
    
    if (paper.keywords && paper.keywords.length > 0) {
        for (const kw of paper.keywords) {
            ris += `KW  - ${kw}\n`;
        }
    }
    
    ris += `PB  - OpenSource Scholar\n`;
    ris += `UR  - https://opensourcescholar.org/paper/${paper.uuid}\n`;
    ris += `ER  - \n`;
    
    return ris;
}

/**
 * Generate CSL-JSON (Citation Style Language JSON)
 */
function generateCSLJSON(paper) {
    const getName = (a) => a.author_name || a.name || a;
    
    const parseAuthorName = (name) => {
        const parts = name.trim().split(/\s+/);
        if (parts.length === 1) {
            return { family: parts[0] };
        }
        return {
            family: parts[parts.length - 1],
            given: parts.slice(0, -1).join(' ')
        };
    };
    
    let type = 'article';
    if (paper.paper_type === 'book') type = 'book';
    if (paper.paper_type === 'thesis') type = 'thesis';
    if (paper.paper_type === 'dataset') type = 'dataset';
    
    const csl = {
        id: paper.uuid,
        type,
        title: paper.title,
        author: paper.authors ? paper.authors.map(a => parseAuthorName(getName(a))) : [],
        issued: paper.publication_year ? { 'date-parts': [[paper.publication_year]] } : undefined,
        abstract: paper.abstract,
        DOI: paper.doi,
        URL: `https://opensourcescholar.org/paper/${paper.uuid}`,
        publisher: 'OpenSource Scholar'
    };
    
    if (paper.keywords && paper.keywords.length > 0) {
        csl.keyword = paper.keywords.join(', ');
    }
    
    // Remove undefined values
    Object.keys(csl).forEach(key => csl[key] === undefined && delete csl[key]);
    
    return csl;
}

/**
 * Generate all citation formats for a paper
 */
function generateAllCitations(paper) {
    return {
        apa: generateAPA(paper),
        mla: generateMLA(paper),
        chicago: generateChicago(paper),
        ieee: generateIEEE(paper),
        bibtex: generateBibTeX(paper),
        ris: generateRIS(paper),
        cslJson: generateCSLJSON(paper)
    };
}

/**
 * Generate citation for a specific format
 */
function generateCitation(paper, format) {
    switch (format.toLowerCase()) {
        case 'apa':
            return generateAPA(paper);
        case 'mla':
            return generateMLA(paper);
        case 'chicago':
            return generateChicago(paper);
        case 'ieee':
            return generateIEEE(paper);
        case 'bibtex':
            return generateBibTeX(paper);
        case 'ris':
            return generateRIS(paper);
        case 'csl':
        case 'csl-json':
        case 'csljson':
            return JSON.stringify(generateCSLJSON(paper), null, 2);
        default:
            throw new Error(`Unknown citation format: ${format}`);
    }
}

module.exports = {
    generateAPA,
    generateMLA,
    generateChicago,
    generateIEEE,
    generateBibTeX,
    generateRIS,
    generateCSLJSON,
    generateAllCitations,
    generateCitation
};
