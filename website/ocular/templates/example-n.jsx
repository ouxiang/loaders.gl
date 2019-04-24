import React from 'react';

import { AutoSizer } from 'react-virtualized';

import { MainExample } from 'ocular-gatsby/src/components/styled';
import WithConfig from 'ocular-gatsby/src/components/layout/website-config';

import ExampleRunner from '../src/components/example-runner';
import EXAMPLES from '../src/components/examples';

export default class ExampleTemplate extends React.Component {
  render() {
    const { pathContext, pageResources } = this.props;
    const { slug } = pathContext;

    const example = EXAMPLES[slug];
    if (!example) {
      console.warn(`No example found: ${slug}`);
    }
    // console.log(example);

    return (
      <WithConfig>
        {({ theme }) => (
          <MainExample theme={theme}>
            <AutoSizer>
              {({ height, width }) =>
                  example && (
                    <ExampleRunner
                      height={height}
                      example={example}
                      sourceLink={
                        pageResources &&
                        pageResources.page &&
                        pageResources.page.path
                      }
                      width={width}
                    />
                  )
                }
            </AutoSizer>
          </MainExample>
          )}
      </WithConfig>
    );
  }
}
